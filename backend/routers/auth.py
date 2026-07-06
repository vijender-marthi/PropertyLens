import os
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
import models
from database import get_db

SECRET_KEY = os.getenv("PROPERTYLENS_SECRET_KEY", "propertylens-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")
router = APIRouter(prefix="/api/auth", tags=["auth"])


class UserCreate(BaseModel):
    email: str
    name: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str = "demo"

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


class UserRoleUpdate(BaseModel):
    role: str


ADMIN_EMAIL = "vijender.marthi@gmail.com"
ALLOWED_ROLES = {"demo", "admin", "superuser"}


def _prep(password: str) -> str:
    """Truncate to 72 bytes (bcrypt limit) using UTF-8 encoding."""
    encoded = password.encode("utf-8")
    return encoded[:72].decode("utf-8", errors="ignore")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(_prep(plain), hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(_prep(password))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        raise credentials_exception
    normalize_user_role(user, db)
    return user


def normalize_user_role(user: models.User, db: Session | None = None) -> str:
    email = (user.email or "").lower()
    current = (getattr(user, "role", None) or "").lower()
    if email == ADMIN_EMAIL:
        effective = "admin"
    elif current in {"admin", "superuser", "demo"}:
        effective = current
    else:
        effective = "demo"
    if current != effective:
        user.role = effective
        if db is not None:
            db.add(user)
            db.commit()
            db.refresh(user)
    return effective


def serialize_user(user: models.User) -> UserOut:
    role = "admin" if (user.email or "").lower() == ADMIN_EMAIL else (user.role or "demo")
    return UserOut(id=user.id, email=user.email, name=user.name, role=role)


def user_role(user: models.User) -> str:
    return normalize_user_role(user)


def is_demo_user(user: models.User) -> bool:
    return user_role(user) == "demo"


def is_admin_user(user: models.User) -> bool:
    return user_role(user) in {"admin", "superuser"}


def require_premium_user(user: models.User):
    if is_demo_user(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Document upload and spreadsheet import are premium features. Demo users can use Manual Entry.",
        )


@router.post("/register", response_model=Token)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == user_in.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = models.User(
        email=user_in.email,
        name=user_in.name,
        hashed_password=hash_password(user_in.password),
        role="admin" if user_in.email.lower() == ADMIN_EMAIL else "demo",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=serialize_user(user),
    )


@router.post("/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=serialize_user(user),
    )


@router.get("/me", response_model=UserOut)
def get_me(current_user: models.User = Depends(get_current_user)):
    return serialize_user(current_user)


@router.get("/admin/users", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    users = db.query(models.User).order_by(models.User.email).all()
    for user in users:
        normalize_user_role(user, db)
    return [serialize_user(user) for user in users]


@router.patch("/admin/users/{user_id}/role", response_model=UserOut)
def update_user_role(
    user_id: int,
    role_in: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    role = (role_in.role or "").lower()
    if role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if (user.email or "").lower() == ADMIN_EMAIL and role != "admin":
        raise HTTPException(status_code=400, detail=f"{ADMIN_EMAIL} must remain admin")
    user.role = role
    db.add(user)
    db.commit()
    db.refresh(user)
    normalize_user_role(user, db)
    return serialize_user(user)
