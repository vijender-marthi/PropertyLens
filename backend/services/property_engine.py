from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import json
from typing import Any, Dict, Iterable, List, Optional


def parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    raw = str(value).strip()
    try:
        return date.fromisoformat(raw[:10])
    except Exception:
        pass
    for fmt in ("%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(raw[:10], fmt).date()
        except Exception:
            continue
    return None


def add_months(value: date, months: int) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    return date(year, month, min(value.day, 28))


def monthly_principal_interest(amount: float, annual_rate: float, years: int) -> float:
    principal = float(amount or 0)
    term_months = max(1, int(years or 30) * 12)
    monthly_rate = float(annual_rate or 0) / 100 / 12
    if principal <= 0:
        return 0.0
    if monthly_rate <= 0:
        return principal / term_months
    return principal * monthly_rate / (1 - (1 + monthly_rate) ** (-term_months))


def loan_monthly_pi(loan: Any) -> float:
    explicit_split = float(getattr(loan, "principal_due", 0) or 0) + float(getattr(loan, "interest_due", 0) or 0)
    if explicit_split > 0:
        return explicit_split
    payment = float(getattr(loan, "monthly_payment", 0) or 0)
    escrow = float(getattr(loan, "escrow_amount", 0) or 0)
    if payment > 0:
        return max(payment - escrow, 0.0)
    return monthly_principal_interest(
        float(getattr(loan, "original_amount", 0) or 0),
        float(getattr(loan, "interest_rate", 0) or 0),
        int(getattr(loan, "loan_term_years", 30) or 30),
    )


@dataclass(frozen=True)
class EngineRow:
    month: date
    interest: float
    principal: float
    payment: float
    balance: float
    source: str


class PropertyEngine:
    def __init__(self, prop: Any, as_of: Optional[date] = None):
        self.prop = prop
        self.as_of = as_of or date.today()
        self._loan_schedules: Dict[int, List[EngineRow]] = {}

    def _reported_statement_map(self, loan: Any) -> Dict[tuple[int, int], Dict[str, float]]:
        reports: Dict[tuple[int, int], Dict[str, float]] = {}
        loan_account = getattr(loan, "account_number", None)
        for doc in getattr(self.prop, "documents", []) or []:
            if getattr(doc, "doc_category", None) != "mortgage_statement" or not getattr(doc, "extracted_data", None):
                continue
            try:
                data = json.loads(doc.extracted_data or "{}")
            except Exception:
                continue
            doc_account = getattr(doc, "loan_account_number", None) or data.get("account_number")
            if loan_account and doc_account and str(loan_account) != str(doc_account):
                continue
            statement_date = parse_date(data.get("statement_date") or getattr(doc, "period_end", None) or getattr(doc, "period_start", None))
            if not statement_date:
                continue
            balance = data.get("current_balance") or data.get("balance") or data.get("outstanding_principal")
            interest = data.get("interest_due") or data.get("interest")
            principal = data.get("principal_due") or data.get("principal")
            reports[(statement_date.year, statement_date.month)] = {
                "balance": float(balance or 0),
                "interest": float(interest or 0),
                "principal": float(principal or 0),
            }
        return reports

    def build_schedule(self, loan: Any) -> List[EngineRow]:
        loan_id = int(getattr(loan, "id", 0) or id(loan))
        if loan_id in self._loan_schedules:
            return self._loan_schedules[loan_id]

        start = parse_date(getattr(loan, "origination_date", None))
        original = float(getattr(loan, "original_amount", 0) or 0)
        if not start or original <= 0:
            self._loan_schedules[loan_id] = []
            return []

        term_months = max(1, int(getattr(loan, "loan_term_years", 30) or 30) * 12)
        monthly_rate = float(getattr(loan, "interest_rate", 0) or 0) / 100 / 12
        payment = loan_monthly_pi(loan) + float(getattr(loan, "extra_monthly_payment", 0) or 0)
        if payment <= 0:
            payment = monthly_principal_interest(original, float(getattr(loan, "interest_rate", 0) or 0), int(getattr(loan, "loan_term_years", 30) or 30))

        rows: List[EngineRow] = []
        balance = original
        reported = self._reported_statement_map(loan)
        month = start
        for _ in range(term_months):
            if month > self.as_of:
                break
            report = reported.get((month.year, month.month))
            if report and report.get("balance", 0) > 0:
                interest = report.get("interest") or (balance * monthly_rate if monthly_rate > 0 else 0.0)
                principal = report.get("principal") or max(balance - report["balance"], 0.0)
                balance = report["balance"]
                source = "REPORTED"
            else:
                interest = balance * monthly_rate if monthly_rate > 0 else 0.0
                principal = min(max(payment - interest, 0.0), balance)
                balance = max(balance - principal, 0.0)
                source = "CALCULATED"
            rows.append(EngineRow(month=month, interest=interest, principal=principal, payment=interest + principal, balance=balance, source=source))
            if balance <= 0:
                break
            month = add_months(month, 1)

        self._loan_schedules[loan_id] = rows
        return rows

    def annual_rows(self, loan: Any, end_year: Optional[int] = None) -> List[Dict[str, Any]]:
        buckets: Dict[int, Dict[str, Any]] = {}
        for row in self.build_schedule(loan):
            if end_year is not None and row.month.year > end_year:
                continue
            bucket = buckets.setdefault(row.month.year, {
                "year": row.month.year,
                "interest_paid": 0.0,
                "principal_paid": 0.0,
                "mortgage_paid": 0.0,
                "ending_balance": row.balance,
                "months": 0,
                "source": "engine",
            })
            bucket["interest_paid"] += row.interest
            bucket["principal_paid"] += row.principal
            bucket["mortgage_paid"] += row.payment
            bucket["ending_balance"] = row.balance
            bucket["months"] += 1
        return [self._round_money_row(buckets[year]) for year in sorted(buckets)]

    def balance_today(self, loan: Any) -> float:
        entered = float(getattr(loan, "current_balance", 0) or 0)
        if entered > 0:
            return entered
        rows = self.build_schedule(loan)
        if rows:
            return rows[-1].balance
        return float(getattr(loan, "original_amount", 0) or 0)

    def annual_interest(self, loan: Any, year: int) -> float:
        return sum(row.interest for row in self.build_schedule(loan) if row.month.year == year)

    def annual_principal(self, loan: Any, year: int) -> float:
        return sum(row.principal for row in self.build_schedule(loan) if row.month.year == year)

    def year_end_balance(self, loan: Any, year: int) -> float:
        rows = [row for row in self.build_schedule(loan) if row.month.year == year]
        if rows:
            return rows[-1].balance
        return 0.0

    def total_balance_today(self) -> float:
        return sum(self.balance_today(loan) for loan in getattr(self.prop, "loans", []) or [])

    def total_interest_accumulated(self) -> float:
        return sum(sum(row.interest for row in self.build_schedule(loan)) for loan in getattr(self.prop, "loans", []) or [])

    def invariant_checks(self) -> List[Dict[str, Any]]:
        checks = []
        for loan in getattr(self.prop, "loans", []) or []:
            if not parse_date(getattr(loan, "origination_date", None)):
                checks.append({
                    "loan_id": getattr(loan, "id", None),
                    "name": getattr(loan, "lender_name", None),
                    "rule": "startDate is required for amortization",
                    "delta": None,
                    "status": "warn",
                })
            original = float(getattr(loan, "original_amount", 0) or 0)
            principal = sum(row.principal for row in self.build_schedule(loan))
            balance = self.balance_today(loan)
            delta = original - principal - balance
            checks.append({
                "loan_id": getattr(loan, "id", None),
                "name": getattr(loan, "lender_name", None),
                "rule": "originalAmount - principalPaid == balanceToday",
                "delta": round(delta, 2),
                "status": "pass" if abs(delta) <= 1 else "warn",
            })
        return checks

    def usage_type(self, year: int) -> str:
        usage_periods = sorted(getattr(self.prop, "usage_periods", []) or [], key=lambda p: getattr(p, "start_date", "") or "")
        for period in usage_periods:
            start = parse_date(getattr(period, "start_date", None))
            end = parse_date(getattr(period, "end_date", None)) or self.as_of
            if start and start.year <= year <= end.year:
                raw = str(getattr(period, "usage_type", "") or "").upper()
                if raw == "PRIMARY":
                    return "PRIMARY"
                if raw == "RENTAL":
                    return "RENTAL"
        periods = getattr(self.prop, "rental_periods", []) or []
        for period in periods:
            start_year = int(getattr(period, "start_year", 0) or 0)
            end_year = int(getattr(period, "end_year", 0) or self.as_of.year)
            if start_year and start_year <= year <= end_year:
                return "RENTAL"
        return "PRIMARY" if str(getattr(self.prop, "usage_type", "") or "").lower() == "primary" else "RENTAL"

    def depreciation(self, year: int) -> Dict[str, Any]:
        if self.usage_type(year) == "PRIMARY":
            return {"applicable": False, "amount": None, "source": "engine"}
        price = float(getattr(self.prop, "purchase_price", 0) or 0)
        land = float(getattr(self.prop, "land_value", 0) or 0)
        basis = max(0.0, price - land)
        years = float(getattr(self.prop, "depreciation_years", 27.5) or 27.5)
        full_year = basis / years if basis > 0 and years > 0 else 0.0
        placed = parse_date(getattr(self.prop, "purchase_date", None)) or date(year, 1, 1)
        usage_periods = sorted(getattr(self.prop, "usage_periods", []) or [], key=lambda p: getattr(p, "start_date", "") or "")
        rental_starts = [
            parse_date(getattr(period, "start_date", None))
            for period in usage_periods
            if str(getattr(period, "usage_type", "") or "").upper() == "RENTAL"
        ]
        rental_starts = [value for value in rental_starts if value]
        if rental_starts:
            placed = min(rental_starts)
        if placed.year == year:
            month_factor = (12 - placed.month + 0.5) / 12
        elif placed.year < year:
            month_factor = 1.0
        else:
            month_factor = 0.0
        amount = full_year * month_factor
        warning = "land not split / basis may be overstated" if land <= 0 and price > 0 else None
        return {
            "applicable": True,
            "basis": round(basis, 2),
            "full_year_amount": round(full_year, 2),
            "amount": round(amount, 2),
            "accumulated": round(amount, 2),
            "warning": warning,
            "source": "engine",
        }

    @staticmethod
    def _round_money_row(row: Dict[str, Any]) -> Dict[str, Any]:
        rounded = dict(row)
        for key in ("interest_paid", "principal_paid", "mortgage_paid", "ending_balance"):
            rounded[key] = round(float(rounded.get(key) or 0), 2)
        return rounded


def build_property_engine(prop: Any, as_of: Optional[date] = None) -> PropertyEngine:
    return PropertyEngine(prop, as_of=as_of)
