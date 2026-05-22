# main.py
from fastapi import FastAPI, HTTPException, Query, Depends, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from fastapi.staticfiles import StaticFiles
from datetime import timedelta

import security
from security import hash_password
from models import User
import pyotp

import asyncio
import json
import random
import crud
from faker import Faker

# --- NEW IMPORTS FOR THE DATABASE ---
import models
import database

app = FastAPI(title="Aegis Track API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

fake = Faker()

from fastapi import WebSocket, WebSocketDisconnect
from tinydb import TinyDB
from datetime import datetime, timezone

# --- 1. INITIALIZE NoSQL DATABASE ---
# This automatically creates a 'chat_history.json' file in your folder
chat_db = TinyDB('chat_history.json')


# --- CHAT CONNECTION MANAGER ---
class ChatConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

        # NoSQL FETCH: When a user joins, send them the last 20 messages from the database!
        history = chat_db.all()
        for msg in history[-20:]:
            await websocket.send_text(msg['message'])

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)


chat_manager = ChatConnectionManager()


# --- THE SECURED CHAT ENDPOINT ---
@app.websocket("/ws/chat")
async def chat_endpoint(websocket: WebSocket):
    # 1. Accept the raw TCP/TLS connection (no auth yet)
    await websocket.accept()

    try:
        # 2. Wait for the very first message — must be an auth payload
        auth_message = await websocket.receive_json()
        token = auth_message.get("token")

        # 3. Verify the JWT using our security helper
        user_payload = security.verify_ws_token(token)

        if not user_payload:
            # Token is missing, fake, or expired → Policy Violation close
            print("WebSocket Auth: Rejected — invalid or expired token.")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # 4. Auth successful — extract the username from the verified payload
        username = user_payload.get("username", "Unknown")
        print(f"✅ WebSocket Authorized for user: {username}")

        # 5. Register this connection with the ChatConnectionManager
        #    (send last 20 messages from TinyDB history)
        chat_manager.active_connections.append(websocket)
        history = chat_db.all()
        for msg in history[-20:]:
            await websocket.send_text(msg['message'])

        # 6. Enter the standard listening loop
        while True:
            data = await websocket.receive_text()

            # NoSQL PERSIST: Save the message document to TinyDB
            chat_db.insert({
                "message": data,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

            # Broadcast to all connected users
            await chat_manager.broadcast(data)

    except WebSocketDisconnect:
        chat_manager.disconnect(websocket)
        print(f"📵 User disconnected from chat.")
    except Exception as e:
        print(f"WebSocket error: {e}")
        # Failsafe: close on any unexpected error
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)

# --- WEBSOCKET MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)


market_manager = ConnectionManager()
generator_task = None


# --- BACKGROUND GENERATOR LOOP ---
async def generate_fake_skins_loop():
    while True:
        await asyncio.sleep(5)

        # 1. We must manually open a database session for background tasks
        db = database.SessionLocal()
        try:
            # 2. Generate the fake market data
            # Added "(Factory New)" to make it look like a real CS2 market hash name
            fake_name = f"{fake.word().capitalize()} | {fake.word().capitalize()} (Factory New)"
            fake_price = round(random.uniform(5.0, 500.0), 2)
            fake_float = round(random.uniform(0.0, 0.07), 4)  # CS2 Factory new float range!

            # 3. Add to DB using our clean Repository Layer
            # We assign it to user_id 1 (our test user)
            new_tracked_item = crud.add_tracked_item(
                db=db,
                user_id=1,
                name=fake_name,
                max_price=fake_price,
                max_float=fake_float
            )

            # 4. Format for the frontend and broadcast
            # We map it exactly to the JSON structure your ui.js expects
            skin_dict = {
                "id": new_tracked_item.id,
                "name": fake_name,  # or new_tracked_item.skin_data.market_hash_name
                "float_value": new_tracked_item.max_float,
                "price": new_tracked_item.max_price
            }

            await market_manager.broadcast(json.dumps([skin_dict]))

        finally:
            # 5. ALWAYS close the background session to prevent memory leaks
            db.close()


@app.post("/generator/start")
async def start_generator():
    global generator_task
    if generator_task is None:
        generator_task = asyncio.create_task(generate_fake_skins_loop())
        return {"message": "Faker Loop Started"}
    return {"message": "Already running"}


@app.post("/generator/stop")
async def stop_generator():
    global generator_task
    if generator_task:
        generator_task.cancel()
        generator_task = None
        return {"message": "Faker Loop Stopped"}
    return {"message": "Not running"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await market_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        market_manager.disconnect(websocket)


# --- PYDANTIC SCHEMAS ---
class SkinBase(BaseModel):
    name: str = Field(..., min_length=3, description="The skin name")
    float_value: Optional[float] = Field(None, ge=0.0, le=1.0)
    price: float = Field(..., gt=0)

class SkinCreate(SkinBase):
    pass

class SkinResponse(SkinBase):
    id: int # This will be the TrackedItem ID so the frontend can delete it later

class AssetAllocationResponse(BaseModel):
    """
    Represents the total dollar value allocated to each asset type.
    """
    skin: float = 0.0
    knife: float = 0.0
    glove: float = 0.0
    case: float = 0.0
    agent: float = 0.0
    charm: float = 0.0
    sticker: float = 0.0
    music_kit: float = 0.0
    graffiti: float = 0.0
    other: float = 0.0

class RarityDistributionResponse(BaseModel):
    """
    Represents the total count of items per rarity tier.
    """
    consumer_grade: int = 0
    industrial_grade: int = 0
    mil_spec_grade: int = 0
    restricted: int = 0
    classified: int = 0
    covert: int = 0
    extraordinary: int = 0

class LoginRequest(BaseModel):
    username: str = Field(..., description="The username to log in with")
    password: str = Field(..., description="The password to log in with")

class UserInfo(BaseModel):
    id: int
    username: str
    role: str
    permissions: list[str]

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserInfo

class UserCreateSchema(BaseModel):
    username: str
    password: str
    steam_id: Optional[str] = None

# --- REST API ENDPOINTS (WATCHLIST CRUD) ---
@app.get("/skins", response_model=list[SkinResponse])
def read_tracked_skins(skip: int = Query(0, ge=0), limit: int = Query(10, gt=0),
                       db: Session = Depends(database.get_db),
                       current_user: dict = Depends(security.get_current_user)):
    """READ: Get the user's watchlist, joining the blueprint data to get the name."""

    # We query TrackedItem, but JOIN SkinCatalog to get the name
    results = db.query(models.TrackedItem, models.SkinCatalog) \
        .join(models.SkinCatalog) \
        .filter(models.TrackedItem.user_id == 1) \
        .offset(skip).limit(limit).all()

    # Format the data exactly how ui.js expects it
    response_data = []
    for tracked, catalog in results:
        response_data.append({
            "id": tracked.id,
            "name": catalog.market_hash_name,
            "float_value": tracked.max_float,
            "price": tracked.max_price
        })

    return response_data


@app.post("/skins", response_model=SkinResponse, status_code=201)
def create_tracked_skin(skin: SkinCreate, db: Session = Depends(database.get_db),
                       current_user: dict = Depends(security.get_current_user)):
    """CREATE: Add an item to the watchlist using the Repository Layer."""

    # Send the data to our clean database layer!
    tracked_item = crud.add_tracked_item(
        db=db,
        user_id=1,
        name=skin.name,
        max_price=skin.price,
        max_float=skin.float_value
    )

    # log the action
    active_user = db.query(models.User).filter(models.User.id == 1).first()
    if active_user:
        crud.log_user_action(db, active_user, f"CREATED_WATCHLIST_ITEM_{tracked_item.id}")

    return {
        "id": tracked_item.id,
        "name": skin.name,
        "float_value": tracked_item.max_float,
        "price": tracked_item.max_price
    }


@app.put("/skins/{skin_id}", response_model=SkinResponse)
def update_tracked_skin(skin_id: int, skin: SkinCreate, db: Session = Depends(database.get_db),
                       current_user: dict = Depends(security.get_current_user)):
    """UPDATE: modify an existing tracked skin."""

    # 1. Find the tracked item (Notice we use skin_id to match the route)
    tracked_item = db.query(models.TrackedItem).filter(models.TrackedItem.id == skin_id).first()

    if not tracked_item:
        raise HTTPException(status_code=404, detail="Tracked skin not found")

    # 2. Handle the Blueprint Check
    # We use our repository function. If the name is the same, it just returns the existing blueprint.
    # If the user changed the name, it safely creates/fetches the new blueprint.
    catalog_item = crud.get_or_create_catalog_item(db, skin.name)

    # 3. Update the tracked item's properties
    tracked_item.skin_catalog_id = catalog_item.id
    tracked_item.max_price = skin.price
    tracked_item.max_float = skin.float_value

    # 4. Save changes to the database
    db.commit()
    db.refresh(tracked_item)

    # track the change
    active_user = db.query(models.User).filter(models.User.id == 1).first()
    if active_user:
        crud.log_user_action(db, active_user, f"UPDATED_WATCHLIST_ITEM_{tracked_item.id}")

    # 5. Return the exact JSON structure your frontend ui.js expects
    return {
        "id": tracked_item.id,
        "name": catalog_item.market_hash_name,
        "float_value": tracked_item.max_float,
        "price": tracked_item.max_price
    }


@app.delete("/skins/{tracked_id}", status_code=204)
def delete_tracked_skin(tracked_id: int, db: Session = Depends(database.get_db),
                       current_user: dict = Depends(security.get_current_user)):
    """DELETE: Remove an item from the watchlist."""

    # Notice we delete by tracked_id, we DO NOT delete the SkinCatalog blueprint!
    tracked_item = db.query(models.TrackedItem).filter(models.TrackedItem.id == tracked_id).first()

    if not tracked_item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")

    db.delete(tracked_item)
    db.commit()

    active_user = db.query(models.User).filter(models.User.id == 1).first()

    # Log the action!
    action_desc = f"DELETED_WATCHLIST_ITEM_{tracked_id}"
    crud.log_user_action(db, active_user, action_desc)

    db.commit()
    return None


# --- STATISTICS ENDPOINTS ---

@app.get("/users/{user_id}/inventory/total_value", response_model=float)
def read_user_inventory_value(user_id: int, db: Session = Depends(database.get_db),
                       current_user: dict = Depends(security.get_current_user)):
    """
    SQL: SELECT SUM(acquired_price) FROM inventory_items WHERE user_id = ?
    """
    # .scalar() returns the raw number instead of a tuple
    total = db.query(func.sum(models.InventoryItem.acquired_price)) \
        .filter(models.InventoryItem.user_id == user_id).scalar()

    return total or 0.0


@app.get("/users/{user_id}/inventory/asset_allocation", response_model=AssetAllocationResponse)
def read_user_asset_allocation(user_id: int, db: Session = Depends(database.get_db),
                       current_user: dict = Depends(security.get_current_user)):
    """
    SQL: SELECT skin_catalog.weapon_type, SUM(inventory_items.acquired_price)
         FROM inventory_items
         JOIN skin_catalog ON inventory_items.skin_catalog_id = skin_catalog.id
         WHERE inventory_items.user_id = ?
         GROUP BY skin_catalog.weapon_type
    """
    results = db.query(
        models.SkinCatalog.weapon_type,
        func.sum(models.InventoryItem.acquired_price)
    ).join(models.InventoryItem).filter(
        models.InventoryItem.user_id == user_id
    ).group_by(models.SkinCatalog.weapon_type).all()

    # Match the Pydantic schema keys your frontend expects
    allocation = {
        "skin": 0.0, "knife": 0.0, "glove": 0.0, "case": 0.0, "agent": 0.0, "charm": 0.0, "sticker": 0.0, "music_kit": 0.0, "graffiti": 0.0, "other": 0.0
    }

    for item_type, total_price in results:
        # Standardize the weapon_type strings to match your dictionary keys
        clean_type = item_type.lower() if item_type else "skin"
        if clean_type in allocation:
            allocation[clean_type] = total_price or 0.0
        else:
            # If it's a Rifle/Pistol/Knife, group it under "skin"
            allocation["skin"] += (total_price or 0.0)

    return allocation


@app.get("/users/{user_id}/inventory/rarity_distribution", response_model=RarityDistributionResponse)
def read_user_rarity_distribution(user_id: int, db: Session = Depends(database.get_db),
                       current_user: dict = Depends(security.get_current_user)):
    """
    SQL: SELECT skin_catalog.rarity, COUNT(inventory_items.id)
         FROM inventory_items
         JOIN skin_catalog ON ...
         WHERE inventory_items.user_id = ?
         GROUP BY skin_catalog.rarity
    """
    results = db.query(
        models.SkinCatalog.rarity,
        func.count(models.InventoryItem.id)
    ).join(models.InventoryItem).filter(
        models.InventoryItem.user_id == user_id
    ).group_by(models.SkinCatalog.rarity).all()

    distribution = {
        "consumer_grade": 0, "industrial_grade": 0, "mil_spec_grade": 0,
        "restricted": 0, "classified": 0, "covert": 0, "extraordinary": 0
    }

    for rarity, count in results:
        # Map DB rarity strings (e.g., "Covert") to your frontend keys ("covert")
        clean_rarity = rarity.lower().replace("-", "_").replace(" ", "_") if rarity else "consumer_grade"
        if clean_rarity in distribution:
            distribution[clean_rarity] = count

    return distribution


@app.get("/admin/observation-list")
def get_observation_list(skip: int = 0, limit: int = 10, db: Session = Depends(database.get_db),
                       current_user: dict = Depends(security.get_current_user)):
    """
    Fetches the observation list.
    In a fully authenticated app, we would verify the Admin token here!
    """
    user_permissions = current_user.get('permissions', [])
    if not "VIEW_SUSPECTS" in user_permissions:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to view this resource.")
    suspects = db.query(models.ObservationList).offset(skip).limit(limit).all()

    # We return the data as dictionaries so it easily converts to JSON
    return [
        {
            "id": s.id,
            "user_id": s.user_id,
            "reason": s.reason,
            "detected_at": s.detected_at
        } for s in suspects
    ]


@app.post("/seed-inventory")
def seed_test_inventory(db: Session = Depends(database.get_db)):
    """A temporary endpoint to inject fake data and set up Roles/Permissions."""

    # --- 0. PREVENT DUPLICATES ---
    # Check if the database is already seeded to prevent unique constraint crashes
    existing_admin = db.query(models.User).filter(models.User.username == "AegisAdmin").first()
    if existing_admin:
        return {"message": "Database is already seeded! You are good to go."}

    # --- 1. SETUP SPECIFIC PERMISSIONS ---
    # Normal User Perms
    p_watchlist_crud = models.Permission(name="WATCHLIST_CRUD")
    p_inventory_read = models.Permission(name="INVENTORY_READ")

    # Admin Perms
    p_view_users = models.Permission(name="VIEW_ALL_USERS")
    p_manage_watchlist = models.Permission(name="MANAGE_ANY_WATCHLIST")
    p_manage_inventory = models.Permission(name="MANAGE_ANY_INVENTORY")
    p_manage_catalog = models.Permission(name="MANAGE_CATALOG")

    db.add_all([
        p_watchlist_crud, p_inventory_read,
        p_view_users, p_manage_watchlist, p_manage_inventory, p_manage_catalog
    ])
    db.commit()

    # --- 2. SETUP ROLES ---
    admin_role = models.Role(
        name="admin",
        permissions=[p_view_users, p_manage_watchlist, p_manage_inventory, p_manage_catalog]
    )
    user_role = models.Role(
        name="normal user",
        permissions=[p_watchlist_crud, p_inventory_read]
    )

    db.add_all([admin_role, user_role])
    db.commit()

    # --- 3. CREATE USERS ---
    dummy_user = models.User(username="AegisTester", steam_id="76561198000000000", role_id=user_role.id)
    admin_user = models.User(username="AegisAdmin", role_id=admin_role.id)

    db.add_all([dummy_user, admin_user])
    db.commit()

    # --- 4. CREATE SKIN CATALOG (THE BLUEPRINTS) ---
    catalog_items = [
        models.SkinCatalog(
            market_hash_name="Desert Eagle | Printstream (Field-Tested)",
            weapon_type="Pistol",
            rarity="Covert",
            icon_url="https://community.cloudflare.steamstatic.com/economy/image"
                     "/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgposr-kLAtl7PLZTjlH_9mkgL-OlvD4NoWElTIFuJwji-uRpNqj2VDm-xVqYjr2IIfBJAQ4aArW_FLqw-nq1pC1uM6dyXZj7CUm5Hnfmgv3308_tN30kQ"
        ),
        models.SkinCatalog(
            market_hash_name="Negev | Army Sheen (Minimal Wear)",
            weapon_type="Heavy",
            rarity="Consumer Grade",
            icon_url=""
        ),
        models.SkinCatalog(
            market_hash_name="Operation Riptide Case",
            weapon_type="Case",
            rarity="Base Grade",
            icon_url=""
        ),
        models.SkinCatalog(
            market_hash_name="Sticker | Titan (Holo) | Katowice 2014",
            weapon_type="Sticker",
            rarity="Extraordinary",
            icon_url=""
        )
    ]
    db.add_all(catalog_items)
    db.commit()

    # --- 5. CREATE TRACKED ITEMS (WATCHLIST) ---
    watchlist = [
        models.TrackedItem(
            user_id=dummy_user.id,
            skin_catalog_id=catalog_items[0].id,  # Tracking the Printstream
            max_price=50.00,
            max_float=0.15
        ),
        models.TrackedItem(
            user_id=dummy_user.id,
            skin_catalog_id=catalog_items[3].id,  # Tracking the Titan Holo
            max_price=50000.00,
            max_float=None  # Stickers don't have floats
        )
    ]
    db.add_all(watchlist)
    db.commit()

    # --- 6. CREATE INVENTORY ITEMS (PHYSICAL GUNS) ---
    inventory = [
        models.InventoryItem(
            user_id=dummy_user.id,
            skin_catalog_id=catalog_items[0].id,
            steam_asset_id="2948192841",
            float_value=0.154,
            acquired_price=54.30
        ),
        models.InventoryItem(
            user_id=dummy_user.id,
            skin_catalog_id=catalog_items[1].id,
            steam_asset_id="9283748123",
            float_value=0.123,
            acquired_price=0.05
        ),
        models.InventoryItem(
            user_id=dummy_user.id,
            skin_catalog_id=catalog_items[2].id,
            steam_asset_id="1029384712",
            float_value=None,  # Cases don't have floats
            acquired_price=13.29
        ),
    ]
    db.add_all(inventory)
    db.commit()

    return {"message": "Enterprise database structure seeded successfully!"}

# AUTHENTICATION ENDPOINTS
# NOTE: response_model removed — the response shape varies:
#   - Normal login  → LoginResponse (access_token + user)
#   - 2FA required  → {requires_2fa: true, pre_auth_token: str}
@app.post("/login")
def login_user(credentials: LoginRequest, db: Session = Depends(database.get_db)):
    # 1. Find the user in the database
    user = db.query(models.User).filter(models.User.username == credentials.username).first()

    # 2. Security Fix: Generic error for BOTH missing user AND bad password
    if not user or not security.verify_password(credentials.password, str(user.password_hash)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. --- 2FA GATE ---
    # If the user has enrolled in 2FA, do NOT issue a real session token yet.
    # Instead, return a narrow pre-auth token that only works at /verify-2fa.
    if user.is_2fa_enabled:
        pre_auth_token = security.create_pre_auth_token(user.id)
        return {
            "requires_2fa": True,
            "pre_auth_token": pre_auth_token
        }

    # 4. Extract the Role and Permissions safely
    role_name = user.role.name if user.role else "guest"
    permissions_list = []
    if user.role and user.role.permissions:
        permissions_list = [perm.name for perm in user.role.permissions]

    # 5. Build and mint the real 1-hour session token
    token_payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": role_name,
        "permissions": permissions_list
    }
    access_token = security.create_access_token(
        data=token_payload,
        expires_delta=timedelta(minutes=60)
    )

    # 6. Return the token AND the user data for the SPA UI
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": role_name,
            "permissions": permissions_list
        }
    }

@app.post("/register", status_code=status.HTTP_201_CREATED)
def register_user(user_data: UserCreateSchema, db: Session = Depends(database.get_db)):
    # 1. Check if username already exists
    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already registered")

    # 2. Hash the plain-text password safely
    secure_hash = hash_password(user_data.password)

    # 3. Create the new user record with the hash
    new_user = User(
        username=user_data.username,
        steam_id=user_data.steam_id,
        role_id=2,  # Defaulting to 'normal user' based on your image mapping
        password_hash=secure_hash
    )

    # 4. Commit to SQLite
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {"message": "User registered successfully"}

@app.get("/admin/logs")
def get_system_logs(skip: int = 0, limit: int = 50, db: Session = Depends(database.get_db),
                       current_user: dict = Depends(security.get_current_user)):
    """Fetches the raw system logs for the Admin panel."""
    user_permissions = current_user.get("permissions", [])

    if "VIEW_SUSPECTS" not in user_permissions:
        raise HTTPException (
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do nat have permission to view system logs"
        )

    # We order by descending ID so the newest logs are at the top
    logs = db.query(models.Log).order_by(models.Log.id.desc()).offset(skip).limit(limit).all()

    return [
        {
            "id": l.id,
            "formatted_entry": l.formatted_entry,  # The exact Gold Challenge string!
            "timestamp": l.timestamp
        } for l in logs
    ]

# --- PASSWORD RECOVERY SCHEMAS ---
class PasswordRecoveryRequest(BaseModel):
    username: str = Field(..., description="The username requesting a password reset")

class ResetPasswordRequest(BaseModel):
    token: str = Field(..., description="The password-reset JWT received via email")
    new_password: str = Field(..., min_length=6, description="The new plain-text password")


# --- PASSWORD RECOVERY ENDPOINTS ---

@app.post("/password-recovery")
def request_password_recovery(payload: PasswordRecoveryRequest, db: Session = Depends(database.get_db)):
    """
    Step 1 of the reset flow.
    Generates a short-lived reset token and 'sends' it via a console print.
    Always returns a generic 200 so attackers cannot enumerate valid usernames.
    """
    GENERIC_RESPONSE = {"message": "If that username exists, a reset link has been sent."}

    # Look up the user — but do NOT reveal whether they exist
    user = db.query(models.User).filter(models.User.username == payload.username).first()
    if not user:
        # Silent success — prevents username enumeration
        return GENERIC_RESPONSE

    # Mint a 15-minute reset token scoped exclusively for password recovery
    reset_token = security.create_password_reset_token(user.username)

    # --- EMAIL SIMULATION ---
    # In production this would call an SMTP / transactional-email service.
    print(
        f"\n[EMAIL SIMULATION] Password reset requested for '{user.username}'.\n"
        f"Please click here to reset your password:\n"
        f"https://127.0.0.1:8000/?token={reset_token}\n"
        # NOTE: The link points to the root (/?token=...) — NOT /reset-password.
        # /reset-password is a POST-only API endpoint. Opening it in a browser
        # would send a GET and get a 404 before the SPA ever loads.
        # The SPA's startup IIFE detects the ?token= param and routes to the reset view.
    )

    return GENERIC_RESPONSE


@app.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(database.get_db)):
    """
    Step 2 of the reset flow.
    Verifies the reset token, then overwrites the user's password hash.
    """
    # Verify the token — returns the username or None if expired/invalid
    username = security.verify_password_reset_token(payload.token)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset link is invalid or has expired. Please request a new one."
        )

    # Fetch the user from the database
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        # Shouldn't happen under normal circumstances, but guard anyway
        raise HTTPException(status_code=404, detail="User not found.")

    # Hash the new password and persist it
    user.password_hash = security.hash_password(payload.new_password)
    db.commit()

    return {"message": "Password updated successfully. You can now log in with your new password."}


# --- 2FA SCHEMAS ---
class Verify2FARequest(BaseModel):
    pre_auth_token: str = Field(..., description="The 5-minute pre-auth JWT from the login response")
    code: str = Field(..., min_length=6, max_length=6, description="The 6-digit TOTP code")

class Setup2FAConfirmRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6, description="A valid code to confirm enrollment")


# --- 2FA ENDPOINTS ---

@app.post("/verify-2fa")
def verify_two_factor(payload: Verify2FARequest, db: Session = Depends(database.get_db)):
    """
    Step 2 of the 2FA login flow.
    Validates the pre-auth token, then checks the TOTP code.
    On success, returns the real session token exactly like a normal login response.
    """
    # 1. Decode the pre-auth token — returns user_id or None
    user_id = security.verify_pre_auth_token(payload.pre_auth_token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Pre-auth session is invalid or has expired. Please log in again."
        )

    # 2. Fetch the user
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=404, detail="User not found or 2FA not configured.")

    # 3. Verify the TOTP code (pyotp handles the 30-second time window)
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(payload.code, valid_window=1):  # valid_window=1 allows ±1 interval for clock skew
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired 2FA code."
        )

    # 4. TOTP passed — mint the real full session token
    role_name = user.role.name if user.role else "guest"
    permissions_list = [perm.name for perm in user.role.permissions] if user.role and user.role.permissions else []

    access_token = security.create_access_token(
        data={
            "sub": str(user.id),
            "username": user.username,
            "role": role_name,
            "permissions": permissions_list
        },
        expires_delta=timedelta(minutes=60)
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": role_name,
            "permissions": permissions_list
        }
    }


@app.post("/setup-2fa")
def setup_two_factor(
    db: Session = Depends(database.get_db),
    current_user: dict = Depends(security.get_current_user)
):
    """
    Step 1 of 2FA enrollment (requires a valid session token).
    Generates a fresh TOTP secret, saves it (unenabled), and returns
    the provisioning URI so the frontend can render a QR code.
    """
    user_id = int(current_user["sub"])
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    # Generate a cryptographically random Base32 secret
    secret = pyotp.random_base32()

    # Save to DB immediately — is_2fa_enabled stays False until /confirm-2fa
    user.totp_secret = secret
    db.commit()

    # Build the otpauth:// URI that authenticator apps scan
    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(
        name=user.username,
        issuer_name="Aegis Tracker"
    )

    return {
        "provisioning_uri": provisioning_uri,
        "secret": secret   # Also returned for manual entry in the authenticator app
    }


@app.post("/confirm-2fa")
def confirm_two_factor(
    payload: Setup2FAConfirmRequest,
    db: Session = Depends(database.get_db),
    current_user: dict = Depends(security.get_current_user)
):
    """
    Step 2 of 2FA enrollment.
    The user submits a valid code from their authenticator app to PROVE
    they scanned it correctly. Only then do we flip is_2fa_enabled = True.
    """
    user_id = int(current_user["sub"])
    user = db.query(models.User).filter(models.User.id == user_id).first()

    if not user or not user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA setup not started. Call /setup-2fa first.")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(payload.code, valid_window=1):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Code is invalid or expired. Please re-scan the QR code."
        )

    # Code is valid — officially enable 2FA for this account
    user.is_2fa_enabled = True
    db.commit()

    return {"message": "Two-factor authentication has been successfully enabled on your account."}


app.mount("/", StaticFiles(directory="AegisTracker-frontend", html=True), name="frontend")