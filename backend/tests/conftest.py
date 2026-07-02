"""
Shared test fixtures for PropertyLens backend tests.

Uses an in-memory SQLite database so tests never touch the production DB.
A single underlying connection is kept open for the lifetime of the process
so that all sessions (both fixture sessions and the API's dependency-injected
sessions) share the same in-memory database.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from jose import jwt
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# Single-connection in-memory SQLite — keeps the DB alive across all sessions.
# SQLite in-memory mode creates one DB per connection; binding all sessions
# to the same connection shares the data correctly.
# ---------------------------------------------------------------------------
TEST_DB_URL = "sqlite:///:memory:"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
_shared_conn = test_engine.connect()           # keep alive for the process
TestSession = sessionmaker(bind=_shared_conn)  # all sessions share this connection

# Patch database module BEFORE importing main/app so that when main.py runs
# Base.metadata.create_all(bind=engine) it targets our test engine/connection.
import database as _db_module
_db_module.engine       = test_engine
_db_module.SessionLocal = TestSession

import models
from main import app
from database import get_db

models.Base.metadata.create_all(bind=_shared_conn)


# ---------------------------------------------------------------------------
# Dependency override — redirect all DB sessions to the shared connection.
# ---------------------------------------------------------------------------
def _test_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = _test_get_db


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def reset_db():
    """Delete all rows before each test for isolation (faster than drop/create)."""
    db = TestSession()
    for table in reversed(models.Base.metadata.sorted_tables):
        db.execute(table.delete())
    db.commit()
    db.close()
    yield


@pytest.fixture
def db():
    session = TestSession()
    try:
        yield session
    finally:
        session.commit()
        session.close()


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# Auth helpers — sub must be the user's email (matches auth.get_current_user)
# ---------------------------------------------------------------------------
SECRET_KEY = "propertylens-secret-key-change-in-production"
ALGORITHM  = "HS256"


def make_token(email: str) -> str:
    payload = {"sub": email, "exp": datetime.utcnow() + timedelta(hours=1)}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def auth_headers(email: str) -> dict:
    return {"Authorization": f"Bearer {make_token(email)}"}


# ---------------------------------------------------------------------------
# Shared model fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def user(db) -> models.User:
    from passlib.context import CryptContext
    ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    u = models.User(
        email="test@propertylens.com",
        name="Test User",
        hashed_password=ctx.hash("password"),
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def prop(db, user) -> models.Property:
    """A basic rental property with one loan — no documents, no tax entries."""
    p = models.Property(
        owner_id=user.id,
        address="123 Test St",
        city="Testville",
        state="TX",
        purchase_date="2020-01-01",
        purchase_price=400_000.0,
        market_value=500_000.0,
        monthly_rent=3_000.0,
        occupancy_rate=100.0,
        property_tax=6_000.0,   # annual
        insurance=1_200.0,      # annual
        land_value=80_000.0,
        depreciation_years=27.5,
        usage_type="Rental",
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    loan = models.Loan(
        property_id=p.id,
        original_amount=320_000.0,
        current_balance=300_000.0,
        interest_rate=6.5,
        monthly_payment=2_023.0,
        loan_term_years=30,
        escrow_amount=0.0,
        interest_due=1_625.0,
        principal_due=398.0,
        origination_date="2020-01-01",
    )
    db.add(loan)
    db.commit()
    db.refresh(p)
    return p
