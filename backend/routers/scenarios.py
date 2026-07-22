"""CRUD for saved Payoff-planner scenarios (per authenticated user).

A scenario stores the planner's full input set plus a snapshot of the headline
results at save time, so the user can switch between plans and compare them.
Inputs and results are opaque JSON blobs owned by the frontend — the backend
only persists and scopes them to the user.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Any, Dict, Optional
import json

import models
from database import get_db
from routers.auth import get_current_user

router = APIRouter(prefix="/api/payoff/scenarios", tags=["payoff-scenarios"])

MAX_SCENARIOS = 20


class ScenarioIn(BaseModel):
    name: str
    inputs: Dict[str, Any]
    results: Optional[Dict[str, Any]] = None


class ScenarioUpdate(BaseModel):
    name: Optional[str] = None
    inputs: Optional[Dict[str, Any]] = None
    results: Optional[Dict[str, Any]] = None


def _serialize(row: models.PayoffScenario) -> Dict[str, Any]:
    def _load(blob, default):
        try:
            return json.loads(blob) if blob else default
        except (TypeError, ValueError):
            return default
    return {
        "id": row.id,
        "name": row.name,
        "inputs": _load(row.inputs, {}),
        "results": _load(row.results, None),
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def _clean_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Scenario name is required")
    return name[:80]


@router.get("")
def list_scenarios(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rows = (
        db.query(models.PayoffScenario)
        .filter(models.PayoffScenario.owner_id == current_user.id)
        .order_by(models.PayoffScenario.created_at.asc())
        .all()
    )
    return [_serialize(r) for r in rows]


@router.post("")
def create_scenario(
    body: ScenarioIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    count = (
        db.query(models.PayoffScenario)
        .filter(models.PayoffScenario.owner_id == current_user.id)
        .count()
    )
    if count >= MAX_SCENARIOS:
        raise HTTPException(status_code=400, detail=f"You can save up to {MAX_SCENARIOS} scenarios. Delete one to add another.")
    row = models.PayoffScenario(
        owner_id=current_user.id,
        name=_clean_name(body.name),
        inputs=json.dumps(body.inputs or {}),
        results=json.dumps(body.results) if body.results is not None else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row)


def _get_owned(scenario_id: int, db: Session, current_user: models.User) -> models.PayoffScenario:
    row = (
        db.query(models.PayoffScenario)
        .filter(
            models.PayoffScenario.id == scenario_id,
            models.PayoffScenario.owner_id == current_user.id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return row


@router.put("/{scenario_id}")
def update_scenario(
    scenario_id: int,
    body: ScenarioUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    row = _get_owned(scenario_id, db, current_user)
    if body.name is not None:
        row.name = _clean_name(body.name)
    if body.inputs is not None:
        row.inputs = json.dumps(body.inputs)
    if body.results is not None:
        row.results = json.dumps(body.results)
    db.commit()
    db.refresh(row)
    return _serialize(row)


@router.delete("/{scenario_id}")
def delete_scenario(
    scenario_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    row = _get_owned(scenario_id, db, current_user)
    db.delete(row)
    db.commit()
    return {"ok": True, "id": scenario_id}
