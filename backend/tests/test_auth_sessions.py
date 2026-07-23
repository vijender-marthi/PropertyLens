from jose import jwt

import models
from routers.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    PASSWORD_RESET_EXPIRE_MINUTES,
    ALGORITHM,
    SECRET_KEY,
    hash_password,
)


def test_login_issues_long_lived_session_token(client, db):
    user = models.User(
        email="owner@example.com",
        name="Owner",
        hashed_password=hash_password("correct-password"),
        role="admin",
    )
    db.add(user)
    db.commit()

    response = client.post(
        "/api/auth/token",
        data={"username": "owner@example.com", "password": "correct-password"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["expires_in_minutes"] == ACCESS_TOKEN_EXPIRE_MINUTES
    assert ACCESS_TOKEN_EXPIRE_MINUTES >= 60 * 24 * 180
    decoded = jwt.decode(body["access_token"], SECRET_KEY, algorithms=[ALGORITHM])
    assert decoded["sub"] == "owner@example.com"


def test_password_reset_request_uses_recovery_window(client, db):
    user = models.User(
        email="owner@example.com",
        name="Owner",
        hashed_password=hash_password("correct-password"),
        role="admin",
    )
    db.add(user)
    db.commit()

    response = client.post(
        "/api/auth/password-reset/request",
        json={"email": "owner@example.com"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["expires_minutes"] == PASSWORD_RESET_EXPIRE_MINUTES
    assert PASSWORD_RESET_EXPIRE_MINUTES >= 60
    decoded = jwt.decode(body["reset_token"], SECRET_KEY, algorithms=[ALGORITHM])
    assert decoded["sub"] == "owner@example.com"
    assert decoded["purpose"] == "password_reset"
