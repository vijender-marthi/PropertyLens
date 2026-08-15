"""AI Coach — a portfolio-aware chat assistant.

The user supplies their own API key (Anthropic / OpenAI / Google) in Settings.
Each chat request builds a compact summary of the user's portfolio and sends it,
with the conversation, to the chosen provider's REST API. Messages are stored so
the coach keeps history; the user can clear it. Keys are never returned to the
client (only whether one is set).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List, Dict
import httpx

import models
from database import get_db
from routers.auth import get_current_user
from routers.properties import compute_property_metrics

router = APIRouter(prefix="/api/coach", tags=["ai-coach"])

DEFAULT_MODELS = {
    "claude": "claude-3-5-sonnet-latest",
    "openai": "gpt-4o-mini",
    "gemini": "gemini-2.5-flash",
}
HISTORY_LIMIT = 40

SYSTEM_PROMPT = (
    "You are the PropertyLens AI Coach, a concise, practical real-estate portfolio "
    "assistant. Use the PORTFOLIO SUMMARY below to answer the user's questions about "
    "cash flow, equity, refinancing, and sell-vs-hold / exit scenarios. Prefer clear, "
    "specific answers with the actual property names and numbers from the summary. "
    "When you make a recommendation, briefly say why. You are not a licensed financial "
    "or tax advisor — add a short reminder to confirm big decisions with a professional "
    "when the question is about taxes or large transactions. Keep answers short unless "
    "asked to elaborate."
)


class SettingsIn(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None  # applied to the selected provider


class ChatIn(BaseModel):
    message: str
    page: Optional[str] = None


def _money(v) -> str:
    try:
        return f"${float(v or 0):,.0f}"
    except Exception:
        return "$0"


def _portfolio_context(db: Session, user: models.User) -> str:
    props = db.query(models.Property).filter(models.Property.owner_id == user.id).all()
    if not props:
        return "The user has no properties in PropertyLens yet."
    lines = []
    tot_val = tot_equity = tot_cf = 0.0
    for p in props:
        m = compute_property_metrics(p)
        val = float(p.market_value or 0.0)
        equity = float(m.get("equity", 0.0) or 0.0)
        mcf = float(m.get("monthly_cash_flow", 0.0) or 0.0)
        rent = float(m.get("effective_rent", 0.0) or 0.0)
        cap = m.get("cap_rate")
        tot_val += val; tot_equity += equity; tot_cf += mcf
        lines.append(
            f"- {p.name or p.address} ({p.usage_type or 'Rental'}): value {_money(val)}, "
            f"equity {_money(equity)}, rent {_money(rent)}/mo, cash flow {_money(mcf)}/mo, "
            f"cap rate {round(float(cap), 2) if cap is not None else 'n/a'}%, "
            f"loan {_money(m.get('loan_balance', val - equity))}."
        )
    header = (
        f"PORTFOLIO SUMMARY ({len(props)} properties). Totals: value {_money(tot_val)}, "
        f"equity {_money(tot_equity)}, monthly cash flow {_money(tot_cf)}.\n"
    )
    return header + "\n".join(lines)


def _call_claude(key: str, model: str, system: str, messages: List[Dict]) -> str:
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": model, "max_tokens": 1024, "system": system, "messages": messages},
        timeout=60,
    )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Anthropic error: {r.text[:300]}")
    data = r.json()
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()


def _call_openai(key: str, model: str, system: str, messages: List[Dict]) -> str:
    r = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
        json={"model": model, "messages": [{"role": "system", "content": system}] + messages},
        timeout=60,
    )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"].strip()


def _call_gemini(key: str, model: str, system: str, messages: List[Dict]) -> str:
    contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in messages]
    r = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        headers={"content-type": "application/json"},
        json={"contents": contents, "systemInstruction": {"parts": [{"text": system}]}},
        timeout=60,
    )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini error: {r.text[:300]}")
    cands = r.json().get("candidates", [])
    if not cands:
        raise HTTPException(status_code=502, detail="Gemini returned no answer.")
    return "".join(p.get("text", "") for p in cands[0]["content"]["parts"]).strip()


def _key_for(user: models.User, provider: str) -> Optional[str]:
    return {
        "claude": user.ai_key_anthropic,
        "openai": user.ai_key_openai,
        "gemini": user.ai_key_google,
    }.get(provider)


@router.get("/settings")
def get_settings(current_user: models.User = Depends(get_current_user)):
    provider = current_user.ai_provider or "claude"
    return {
        "provider": provider,
        "model": current_user.ai_model or DEFAULT_MODELS.get(provider),
        "defaultModels": DEFAULT_MODELS,
        "keySet": {
            "claude": bool(current_user.ai_key_anthropic),
            "openai": bool(current_user.ai_key_openai),
            "gemini": bool(current_user.ai_key_google),
        },
    }


@router.post("/settings")
def save_settings(body: SettingsIn, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if body.provider in DEFAULT_MODELS:
        current_user.ai_provider = body.provider
    if body.model is not None:
        current_user.ai_model = body.model.strip() or None
    if body.api_key:
        target = body.provider or current_user.ai_provider or "claude"
        if target == "claude":
            current_user.ai_key_anthropic = body.api_key.strip()
        elif target == "openai":
            current_user.ai_key_openai = body.api_key.strip()
        elif target == "gemini":
            current_user.ai_key_google = body.api_key.strip()
    db.commit()
    return get_settings(current_user)


@router.get("/history")
def get_history(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    msgs = db.query(models.CoachMessage).filter(
        models.CoachMessage.owner_id == current_user.id
    ).order_by(models.CoachMessage.id).all()
    return {"messages": [{"role": m.role, "content": m.content, "at": m.created_at} for m in msgs]}


@router.delete("/history")
def clear_history(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db.query(models.CoachMessage).filter(models.CoachMessage.owner_id == current_user.id).delete()
    db.commit()
    return {"ok": True}


@router.post("/chat")
def chat(body: ChatIn, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is empty.")
    provider = current_user.ai_provider or "claude"
    key = _key_for(current_user, provider)
    if not key:
        raise HTTPException(status_code=400, detail=f"No API key set for {provider}. Add one in Settings → AI Coach.")
    model = current_user.ai_model or DEFAULT_MODELS.get(provider)

    prior = db.query(models.CoachMessage).filter(
        models.CoachMessage.owner_id == current_user.id
    ).order_by(models.CoachMessage.id.desc()).limit(HISTORY_LIMIT).all()
    convo = [{"role": m.role, "content": m.content} for m in reversed(prior)]
    convo.append({"role": "user", "content": message})

    system = SYSTEM_PROMPT + "\n\n" + _portfolio_context(db, current_user)
    if body.page:
        system += (
            f"\n\nThe user is currently on the '{body.page}' page of PropertyLens. "
            "If their question is general or ambiguous, assume it's about what that page shows. "
            "If they explicitly mention a different area (taxes, loans, income, a specific property), answer about that instead."
        )
    if provider == "claude":
        reply = _call_claude(key, model, system, convo)
    elif provider == "openai":
        reply = _call_openai(key, model, system, convo)
    else:
        reply = _call_gemini(key, model, system, convo)

    db.add(models.CoachMessage(owner_id=current_user.id, role="user", content=message))
    db.add(models.CoachMessage(owner_id=current_user.id, role="assistant", content=reply))
    db.commit()
    return {"reply": reply, "provider": provider, "model": model}
