from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from services.formula_catalog import get_formula_catalog


router = APIRouter(prefix="/api/help", tags=["help"])


@router.get("/formulas")
def formulas(
    page: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    sourceType: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
):
    return get_formula_catalog(
        page=page,
        section=section,
        source_type=sourceType,
        query=q,
    )
