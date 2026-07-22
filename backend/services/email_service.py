"""Outbound email via SMTP, configured entirely through environment variables.

Set these to enable real delivery (e.g. for password-reset codes):
  SMTP_HOST       - SMTP server hostname (required to enable email)
  SMTP_PORT       - default 587 (STARTTLS); use 465 for implicit TLS
  SMTP_USER       - login username (optional for open relays)
  SMTP_PASSWORD   - login password
  SMTP_FROM       - From address (defaults to SMTP_USER)
  SMTP_TLS        - "false" to disable STARTTLS on port 587
  FRONTEND_BASE_URL - used to build links in emails (default http://localhost:5177)

When SMTP_HOST is unset, email_configured() is False and callers fall back to a
development behaviour (never in production).
"""
import os
import ssl
import smtplib
import logging
from email.message import EmailMessage

logger = logging.getLogger("propertylens.email")


def email_configured() -> bool:
    return bool(os.getenv("SMTP_HOST"))


def frontend_base_url() -> str:
    return os.getenv("FRONTEND_BASE_URL", "http://localhost:5177").rstrip("/")


def send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    """Send a plain-text (optionally multipart) email. Returns True on success."""
    host = os.getenv("SMTP_HOST")
    if not host:
        return False
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM", user or "no-reply@propertylens.app")
    use_tls = os.getenv("SMTP_TLS", "true").lower() != "false"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=15) as server:
                if user:
                    server.login(user, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=15) as server:
                if use_tls:
                    server.starttls(context=ssl.create_default_context())
                if user:
                    server.login(user, password)
                server.send_message(msg)
        return True
    except Exception as exc:  # noqa: BLE001 - log and report failure to the caller
        logger.error("Failed to send email to %s: %s", to_email, exc)
        return False


def send_password_reset_email(to_email: str, code: str, expires_minutes: int) -> bool:
    """Email a password-reset recovery code. Returns True if the message was sent."""
    subject = "Your PropertyLens password reset code"
    text = (
        "We received a request to reset your PropertyLens password.\n\n"
        f"Recovery code:\n{code}\n\n"
        f"Open {frontend_base_url()}/login, choose \"Forgot password?\", and paste this "
        f"code to set a new password. The code expires in {expires_minutes} minutes.\n\n"
        "If you didn't request this, you can ignore this email — your password won't change."
    )
    html = (
        f"<p>We received a request to reset your PropertyLens password.</p>"
        f"<p style='font-size:14px;color:#555'>Recovery code:</p>"
        f"<p style='font-family:monospace;font-size:16px;word-break:break-all;background:#f1f5f9;"
        f"padding:12px;border-radius:8px'>{code}</p>"
        f"<p>Open <a href='{frontend_base_url()}/login'>PropertyLens</a>, choose "
        f"\"Forgot password?\", and paste this code to set a new password. "
        f"It expires in {expires_minutes} minutes.</p>"
        f"<p style='color:#888;font-size:13px'>If you didn't request this, ignore this email — "
        f"your password won't change.</p>"
    )
    return send_email(to_email, subject, text, html)
