from datetime import datetime, timedelta, timezone
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException, status
import bcrypt
import jwt


SECRET_KEY = "your-super-secret-dev-key-change-this-later"
ALGORITHM = "HS256"

def hash_password(password: str) -> str:
    """
    Takes a plain-text string, encodes it to bytes, 
    generates a secure salt, hashes it, and returns a utf-8 string.
    """
    # Convert plain text string to bytes
    password_bytes = password.encode('utf-8')

    # Generate a secure salt (automatically sets round counts)
    salt = bcrypt.gensalt()

    # Hash the password
    hashed_bytes = bcrypt.hashpw(password_bytes, salt)

    # Decode back to a readable string to store safely in SQLite VARCHAR
    return hashed_bytes.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a plain text password string against the stored database hash string.
    """
    try:
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')

        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """
    Creates a digitally signed JWT containing user data.
    """
    to_encode = data.copy()

    # Set expiration time to manage sessions securely
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=60)

    to_encode.update({"exp": expire})

    # Sign the token using your secret key
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def verify_ws_token(token: str):
    """
    Decodes the JWT for WebSocket connections.
    Returns the payload dictionary if valid, or None if invalid/expired.
    """
    try:
        # Uses the same SECRET_KEY and ALGORITHM defined earlier
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        print("WebSocket Auth: Token expired")
        return None
    except jwt.InvalidTokenError:
        print("WebSocket Auth: Invalid token")
        return None


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """
    This is your main dependency bouncer. It intercepts the request,
    grabs the token, verifies the signature, and returns the payload.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        # Decode the token using the same secret key you used to mint it
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload

    except jwt.ExpiredSignatureError:
        # Token is cryptographically valid, but its time is up
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has expired. Please log in again."
        )
    except jwt.InvalidTokenError:
        # The token is fake, malformed, or tampered with
        raise credentials_exception


# --- PASSWORD RESET HELPERS ---

def create_password_reset_token(username: str) -> str:
    """
    Generates a short-lived JWT (15 minutes) for password recovery.
    A dedicated 'purpose' claim is added so this token can NEVER be
    mistakenly accepted as a regular login session token.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    payload = {
        "sub": username,        # The subject — identifies the user
        "exp": expire,          # Hard expiry — 15 minutes from now
        "purpose": "password_reset"  # Guard against token misuse
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_password_reset_token(token: str) -> str | None:
    """
    Decodes a password-reset JWT.
    Returns the username (str) if the token is valid and unexpired,
    or None if it is expired, malformed, or intended for a different purpose.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        # Reject tokens that were not explicitly minted for password resets
        if payload.get("purpose") != "password_reset":
            return None

        return payload.get("sub")  # The username stored in the 'sub' claim

    except jwt.ExpiredSignatureError:
        print("Password Reset: Token has expired.")
        return None
    except jwt.InvalidTokenError:
        print("Password Reset: Invalid token.")
        return None


# --- 2FA PRE-AUTH TOKEN HELPERS ---

def create_pre_auth_token(user_id: int) -> str:
    """
    Generates a narrow-scoped, 5-minute JWT issued AFTER a correct password
    but BEFORE the TOTP code is verified.

    This token can only be used at /verify-2fa — it carries no role or permissions,
    so it is useless as a regular session token.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    payload = {
        "sub": str(user_id),   # The user ID — enough to look them up
        "exp": expire,         # Hard 5-minute window
        "type": "pre-auth"     # Scope guard: rejected by get_current_user
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_pre_auth_token(token: str) -> int | None:
    """
    Decodes a pre-auth JWT and returns the user_id (int) if valid.
    Returns None if the token is expired, invalid, or not a pre-auth token.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        # Reject anything that isn't explicitly a pre-auth token
        if payload.get("type") != "pre-auth":
            return None

        user_id = payload.get("sub")
        return int(user_id) if user_id is not None else None

    except jwt.ExpiredSignatureError:
        print("2FA Pre-Auth: Token has expired.")
        return None
    except jwt.InvalidTokenError:
        print("2FA Pre-Auth: Invalid token.")
        return None