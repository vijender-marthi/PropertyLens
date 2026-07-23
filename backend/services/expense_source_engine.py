"""Backend-only selection and calendar allocation for document-backed expenses."""
from __future__ import annotations

import json
import re
import uuid
from collections import defaultdict
from datetime import date
from typing import Any, Dict, Iterable, List, Optional

import models
from services.formatters import format_currency


EXPENSE_TYPE_FIELDS = {
    "PROPERTY_TAX": ("property_tax", "property_tax_source", "PROPERTY_TAX"),
    "HOMEOWNERS_INSURANCE": ("insurance", "insurance_source", "INSURANCE"),
}


def _json(value: Any) -> str:
    return json.dumps(value, default=str)


def _money_exact(value: float) -> str:
    return f"${float(value):,.2f}"


def _loads(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(value) if value else fallback
    except (TypeError, ValueError):
        return fallback


def _document_payload(doc: models.Document) -> Dict[str, Any]:
    extracted = _loads(doc.extracted_data, {})
    return {
        "id": doc.id,
        "name": doc.display_name or doc.original_filename,
        "documentType": doc.doc_category,
        "servicer": extracted.get("servicer") or extracted.get("lender_name"),
        "statementDate": extracted.get("statement_date"),
        "loanNumberMasked": _mask(extracted.get("loan_number") or doc.loan_account_number),
        "originalFilename": doc.original_filename,
        "previewUrl": f"/properties/{doc.property_id}/documents?documentId={doc.id}",
    }


def _mask(value: Any) -> Optional[str]:
    digits = re.sub(r"\D", "", str(value or ""))
    return f"****{digits[-4:]}" if digits else None


def replace_escrow_activities(db, payment: models.EscrowPayment, extracted: Dict[str, Any]) -> None:
    db.query(models.EscrowActivity).filter(
        models.EscrowActivity.document_id == payment.document_id
    ).delete(synchronize_session=False)
    for source in extracted.get("activities") or []:
        db.add(models.EscrowActivity(
            id=str(uuid.uuid4()),
            escrow_payment_id=payment.id,
            property_id=payment.property_id,
            owner_id=payment.owner_id,
            document_id=payment.document_id,
            activity_date=source.get("activity_date"),
            activity_type=source.get("activity_type") or "OTHER",
            source_description=source.get("source_description"),
            phase=source.get("phase"),
            value_status=source.get("value_status"),
            estimated_deposit=source.get("estimated_deposit"),
            actual_deposit=source.get("actual_deposit"),
            estimated_disbursement=source.get("estimated_disbursement"),
            actual_disbursement=source.get("actual_disbursement"),
            estimated_balance=source.get("estimated_balance"),
            actual_balance=source.get("actual_balance"),
            required_balance=source.get("required_balance"),
        ))


def _direct_candidates(db, property_id: int, year: int, expense_type: str) -> List[Dict[str, Any]]:
    category = "property_tax" if expense_type == "PROPERTY_TAX" else "insurance_declaration"
    keys = ("annual_property_tax", "property_tax_amount", "taxes_paid") if expense_type == "PROPERTY_TAX" else ("annual_insurance", "insurance_premium")
    candidates = []
    for doc in db.query(models.Document).filter(
        models.Document.property_id == property_id,
        models.Document.doc_category == category,
    ).all():
        extracted = _loads(doc.extracted_data, {})
        if expense_type == "PROPERTY_TAX":
            installment_inputs = []
            seen_installments = set()
            for installment in extracted.get("installments") or []:
                payment_date = installment.get("payment_date") or installment.get("paid_date")
                amount = installment.get("amount")
                if not payment_date or amount is None or str(installment.get("status") or "").lower() != "paid":
                    continue
                match = re.match(r"((?:19|20)\d{2})-\d{2}-\d{2}", str(payment_date))
                if not match or int(match.group(1)) != year:
                    continue
                dedupe_key = (str(payment_date), round(float(amount), 2))
                if dedupe_key in seen_installments:
                    continue
                seen_installments.add(dedupe_key)
                installment_inputs.append({
                    "date": payment_date,
                    "label": f"Property-tax installment {installment.get('installment') or ''}".strip(),
                    "value": round(float(amount), 2),
                    "display": _money_exact(float(amount)),
                })
            if installment_inputs:
                candidates.append({
                    "document": doc,
                    "value": round(sum(item["value"] for item in installment_inputs), 2),
                    "sourceType": "PROPERTY_TAX_BILL",
                    "inputs": installment_inputs,
                })
                continue
        doc_year = extracted.get("tax_year") or doc.statement_year or extracted.get("statement_year")
        match = re.search(r"(?:19|20)\d{2}", str(doc_year or extracted.get("period_start") or ""))
        if not match or int(match.group(0)) != year:
            continue
        value = next((extracted.get(key) for key in keys if extracted.get(key) is not None), None)
        if value is not None:
            candidates.append({
                "document": doc,
                "value": round(float(value), 2),
                "sourceType": "PROPERTY_TAX_BILL" if expense_type == "PROPERTY_TAX" else "INSURANCE_BILL",
                "inputs": [],
            })
    return candidates


def _projection_fallback(db, property_id: int, year: int, expense_type: str) -> Optional[Dict[str, Any]]:
    """Prorate a document-level projection only when no activity ledger exists."""
    from datetime import datetime

    field = "projected_tax" if expense_type == "PROPERTY_TAX" else "projected_insurance"
    def parse_period(value: str, *, end: bool = False):
        import calendar
        for fmt in ("%Y-%m-%d", "%B %Y", "%b %Y", "%m/%d/%Y"):
            try:
                parsed = datetime.strptime(value[:10] if fmt == "%Y-%m-%d" else value, fmt).date()
                return parsed.replace(day=calendar.monthrange(parsed.year, parsed.month)[1] if end else 1)
            except (TypeError, ValueError):
                continue
        return None
    candidates = []
    for payment in db.query(models.EscrowPayment).filter_by(property_id=property_id).all():
        if any(
            row.phase == "PROJECTED" and row.activity_type == expense_type
            for row in payment.activities
        ):
            continue
        value = getattr(payment, field, None)
        if value is None:
            continue
        if not payment.projection_period_start or not payment.projection_period_end:
            if int(payment.expense_year or 0) == year:
                candidates.append({
                    "payment": payment, "value": round(float(value), 2), "coveredMonths": 12,
                    "totalMonths": 12, "statementDate": payment.statement_date or "",
                })
            continue
        start = parse_period(payment.projection_period_start)
        end = parse_period(payment.projection_period_end, end=True)
        if not start or not end:
            continue
        months = []
        cursor = start.replace(day=1)
        while cursor <= end:
            months.append(cursor)
            cursor = date(cursor.year + (cursor.month == 12), 1 if cursor.month == 12 else cursor.month + 1, 1)
        selected_months = [month for month in months if month.year == year]
        if not selected_months:
            continue
        allocated = round(float(value) * len(selected_months) / len(months), 2)
        candidates.append({
            "payment": payment, "value": allocated, "coveredMonths": len(selected_months),
            "totalMonths": len(months), "statementDate": payment.statement_date or "",
        })
    return max(candidates, key=lambda item: item["statementDate"]) if candidates else None


def _upsert_metric(db, *, prop, year: int, expense_type: str, value: Optional[float], status: str,
                   completeness: str, source_type: str, source_label: str, allocation_method: str,
                   coverage: Dict[str, Any], formula: str, inputs: List[Dict[str, Any]],
                   computation: str, document_ids: List[int], supporting_ids: List[int],
                   discrepancies: List[Dict[str, Any]], excluded: List[Dict[str, Any]], confidence: float):
    metric = db.query(models.AnnualExpenseMetric).filter_by(
        property_id=prop.id, year=year, expense_type=expense_type,
    ).first()
    if not metric:
        metric = models.AnnualExpenseMetric(
            id=str(uuid.uuid4()), property_id=prop.id, owner_id=prop.owner_id,
            year=year, expense_type=expense_type,
        )
        db.add(metric)
    metric.value = value
    metric.status = status
    metric.completeness = completeness
    metric.source_type = source_type
    metric.source_label = source_label
    metric.allocation_method = allocation_method
    metric.coverage_json = _json(coverage)
    metric.formula = formula
    metric.inputs_json = _json(inputs)
    metric.computation = computation
    metric.document_ids_json = _json(document_ids)
    metric.supporting_document_ids_json = _json(supporting_ids)
    metric.discrepancies_json = _json(discrepancies)
    metric.excluded_rows_json = _json(excluded)
    metric.confidence = confidence
    return metric


def rebuild_annual_expenses(db, prop: models.Property) -> List[models.AnnualExpenseMetric]:
    """Rebuild selected tax/insurance values from canonical documents and ledger rows."""
    activities = db.query(models.EscrowActivity).filter_by(property_id=prop.id).all()
    grouped: Dict[tuple, List[models.EscrowActivity]] = defaultdict(list)
    years = set()
    for row in activities:
        if row.activity_type not in EXPENSE_TYPE_FIELDS or not row.activity_date:
            continue
        year = int(row.activity_date[:4])
        years.add(year)
        grouped[(year, row.activity_type)].append(row)
    for doc in db.query(models.Document).filter(models.Document.property_id == prop.id).all():
        if doc.doc_category in {"property_tax", "insurance_declaration"}:
            extracted = _loads(doc.extracted_data, {})
            installment_years = {
                int(match.group(0))
                for row in (extracted.get("installments") or [])
                if (match := re.match(r"(?:19|20)\d{2}", str(row.get("payment_date") or row.get("paid_date") or "")))
            }
            years.update(installment_years)
            if not installment_years:
                match = re.search(r"(?:19|20)\d{2}", str(doc.statement_year or doc.period_start or ""))
                if match:
                    years.add(int(match.group(0)))
    for payment in db.query(models.EscrowPayment).filter_by(property_id=prop.id).all():
        for value in (payment.history_period_start, payment.history_period_end, payment.projection_period_start, payment.projection_period_end):
            if value and re.match(r"(?:19|20)\d{2}", value):
                years.add(int(value[:4]))
    years.update(int(row.year) for row in prop.annual_expenses if row.year)

    metrics = []
    existing_metrics = {
        (metric.year, metric.expense_type): metric
        for metric in db.query(models.AnnualExpenseMetric).filter_by(property_id=prop.id).all()
    }
    selected_keys = set()
    docs_by_id = {doc.id: doc for doc in db.query(models.Document).filter(models.Document.property_id == prop.id).all()}
    for year in sorted(years):
        annual = db.query(models.AnnualExpense).filter_by(property_id=prop.id, year=year).first()
        if not annual:
            annual = models.AnnualExpense(property_id=prop.id, owner_id=prop.owner_id, year=year)
            db.add(annual)
        for expense_type, (field, source_field, _) in EXPENSE_TYPE_FIELDS.items():
            rows = grouped.get((year, expense_type), [])
            actual = [row for row in rows if row.phase == "HISTORICAL" and row.value_status == "ACTUAL" and row.actual_disbursement is not None and row.actual_disbursement > 0]
            projected = [row for row in rows if row.phase == "PROJECTED" and row.estimated_disbursement is not None and row.estimated_disbursement > 0]
            direct = _direct_candidates(db, prop.id, year, expense_type)
            fallback_projection = _projection_fallback(db, prop.id, year, expense_type) if not actual and not projected else None
            expected = 2 if expense_type == "PROPERTY_TAX" else 1
            existing_value = float(getattr(annual, field, 0) or 0)
            existing_source = str(getattr(annual, source_field, "manual") or "manual")
            notes = _loads(annual.notes, {})
            manual_locked = bool((notes.get("locks") or {}).get(field))

            selected_rows: Iterable[models.EscrowActivity] = actual or projected
            source_type = "ESCROW_DISBURSEMENT" if actual else "ESCROW_PROJECTION"
            status = "ACTUAL" if actual else "PROJECTED"
            completeness = "COMPLETE" if len(actual) >= expected else ("PARTIAL" if actual else "PROJECTED")
            allocation = "TRANSACTION_DATE" if actual else "PROJECTED_ACTIVITY_DATE"
            confidence = .99 if actual and completeness == "COMPLETE" else (.88 if actual else .78)

            if not actual and direct:
                selected_rows = []
                source_type = direct[0]["sourceType"]
                status = "ACTUAL"
                completeness = "COMPLETE"
                allocation = "TRANSACTION_DATE" if any(item.get("inputs") for item in direct) else "DOCUMENT_TAX_YEAR"
                confidence = .95
                direct_inputs = []
                seen_inputs = set()
                for candidate in direct:
                    for item in candidate.get("inputs") or []:
                        key = (item.get("date"), item.get("value"))
                        if key not in seen_inputs:
                            seen_inputs.add(key)
                            direct_inputs.append(item)
                value = round(
                    sum(item["value"] for item in direct_inputs)
                    if direct_inputs else sum(candidate["value"] for candidate in direct),
                    2,
                )
                selected_doc_ids = sorted({candidate["document"].id for candidate in direct})
            elif actual or projected:
                value = round(sum(float(row.actual_disbursement if actual else row.estimated_disbursement) for row in selected_rows), 2)
                selected_doc_ids = sorted({row.document_id for row in selected_rows})
            elif fallback_projection:
                value = fallback_projection["value"]
                selected_doc_ids = [fallback_projection["payment"].document_id]
                source_type, status, completeness, allocation, confidence = "ESCROW_PROJECTION", "PROJECTED", "PROJECTED", "PROJECTED_PRORATED", .65
            elif manual_locked or (existing_value > 0 and existing_source == "manual"):
                value = existing_value
                selected_doc_ids = []
                source_type, status, completeness, allocation, confidence = "MANUAL", "MANUAL", "COMPLETE", "MANUAL", 1.0
            else:
                stale = existing_metrics.get((year, expense_type))
                if stale:
                    if existing_source != "manual":
                        setattr(annual, field, 0.0)
                        setattr(annual, source_field, "manual")
                continue

            supporting_ids = []
            discrepancies = []
            if actual and direct:
                for candidate in direct:
                    diff = round(candidate["value"] - value, 2)
                    supporting_ids.append(candidate["document"].id)
                    if abs(diff) > max(1.0, value * .005):
                        discrepancies.append({
                            "type": "SOURCE_VALUE_MISMATCH", "selectedValue": value,
                            "supportingValue": candidate["value"], "difference": diff,
                            "documentId": candidate["document"].id,
                        })

            inputs = [{
                "date": row.activity_date,
                "label": row.source_description or expense_type.replace("_", " ").title(),
                "value": round(float(row.actual_disbursement if actual else row.estimated_disbursement), 2),
                "display": _money_exact(float(row.actual_disbursement if actual else row.estimated_disbursement)),
            } for row in selected_rows]
            if direct and not (actual or projected):
                inputs = direct_inputs or [{
                    "date": None,
                    "label": direct[0]["document"].display_name or direct[0]["document"].original_filename,
                    "value": value,
                    "display": _money_exact(value),
                }]
            elif fallback_projection:
                inputs = [{
                    "date": fallback_projection["payment"].projection_period_start,
                    "label": f'{fallback_projection["coveredMonths"]} of {fallback_projection["totalMonths"]} projected months',
                    "value": value,
                    "display": _money_exact(value),
                }]
            formula = " + ".join(item["label"] for item in inputs) if inputs else "Manual annual value"
            computation = " + ".join(item["display"] for item in inputs) + f" = {_money_exact(value)}" if inputs else _money_exact(value)
            statement_docs = [docs_by_id[doc_id] for doc_id in selected_doc_ids if doc_id in docs_by_id]
            statement_dates = [(_loads(doc.extracted_data, {}).get("statement_date")) for doc in statement_docs]
            statement_date = max((item for item in statement_dates if item), default=None)
            source_label = (
                f"Escrow · {date.fromisoformat(statement_date).strftime('%b %Y')}" if source_type.startswith("ESCROW") and statement_date
                else ("Property Tax Bills" if len(selected_doc_ids) > 1 else "Property Tax Bill") if source_type == "PROPERTY_TAX_BILL"
                else "Insurance Document" if source_type == "INSURANCE_BILL"
                else "Manual"
            )
            if supporting_ids:
                source_label = "Escrow + Tax Bill" if expense_type == "PROPERTY_TAX" else "Escrow + Insurance Bill"
            coverage = {
                "calendarYearStart": f"{year}-01-01", "calendarYearEnd": f"{year}-12-31",
                "sourcePeriodStart": min((row.escrow_payment.history_period_start if actual else row.escrow_payment.projection_period_start for row in selected_rows), default=None),
                "sourcePeriodEnd": max((row.escrow_payment.history_period_end if actual else row.escrow_payment.projection_period_end for row in selected_rows), default=None),
                "observedInstallments": len(actual) if actual else len(inputs) if allocation == "TRANSACTION_DATE" else 0,
                "expectedInstallments": expected,
            }
            excluded = [{"date": row.activity_date, "type": row.activity_type, "reason": "Escrow deposits and balances are not operating expenses"}
                        for row in activities if row.activity_date and row.activity_date.startswith(str(year)) and row.activity_type not in EXPENSE_TYPE_FIELDS][:20]
            metric = _upsert_metric(
                db, prop=prop, year=year, expense_type=expense_type, value=value, status=status,
                completeness=completeness, source_type=source_type, source_label=source_label,
                allocation_method=allocation, coverage=coverage, formula=formula, inputs=inputs,
                computation=computation, document_ids=selected_doc_ids, supporting_ids=supporting_ids,
                discrepancies=discrepancies, excluded=excluded, confidence=confidence,
            )
            metrics.append(metric)
            selected_keys.add((year, expense_type))
            if not manual_locked:
                setattr(annual, field, value)
                setattr(annual, source_field, "reported" if source_type in {"ESCROW_DISBURSEMENT", "PROPERTY_TAX_BILL", "INSURANCE_BILL"} else "escrow-estimate" if source_type == "ESCROW_PROJECTION" else "manual")
                annual.source_status = "partial" if completeness == "PARTIAL" else status.lower()
    for key, metric in existing_metrics.items():
        if key not in selected_keys:
            db.delete(metric)
    return metrics


def metric_dto(metric: models.AnnualExpenseMetric, documents: Dict[int, models.Document]) -> Dict[str, Any]:
    doc_ids = _loads(metric.document_ids_json, [])
    supporting_ids = _loads(metric.supporting_document_ids_json, [])
    return {
        "year": metric.year,
        "expenseType": metric.expense_type,
        "value": metric.value,
        "display": "—" if metric.value is None else format_currency(metric.value),
        "status": metric.status,
        "completeness": metric.completeness,
        "sourceType": metric.source_type,
        "sourceLabel": metric.source_label,
        "allocationMethod": metric.allocation_method,
        "coverage": _loads(metric.coverage_json, {}),
        "formula": metric.formula,
        "inputs": _loads(metric.inputs_json, []),
        "computation": metric.computation,
        "documentIds": doc_ids,
        "supportingDocumentIds": supporting_ids,
        "documents": [_document_payload(documents[doc_id]) for doc_id in doc_ids if doc_id in documents],
        "supportingDocuments": [_document_payload(documents[doc_id]) for doc_id in supporting_ids if doc_id in documents],
        "discrepancies": _loads(metric.discrepancies_json, []),
        "excludedRows": _loads(metric.excluded_rows_json, []),
        "confidence": metric.confidence,
    }
