from secrets import compare_digest

from app.core.config import get_settings


def has_admin_bearer(authorization: str | None) -> bool:
    admin_token = get_settings().admin_token
    if not admin_token:
        return False
    scheme, _, token = (authorization or "").partition(" ")
    return scheme.casefold() == "bearer" and compare_digest(token, admin_token)
