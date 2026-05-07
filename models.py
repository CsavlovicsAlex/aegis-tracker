# models.py
from sqlalchemy import Column, Integer, String, Float, ForeignKey, Table
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime, timezone

# --- ASSOCIATION TABLE (Many-to-Many for Roles and Permissions) ---
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id"), primary_key=True),
    Column("permission_id", Integer, ForeignKey("permissions.id"), primary_key=True)
)


# --- ROLES AND PERMISSIONS TABLES ---
class Permission(Base):
    __tablename__ = "permissions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    # Links back to the roles
    roles = relationship("Role", secondary=role_permissions, back_populates="permissions")


class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    # Links to the permissions and users
    permissions = relationship("Permission", secondary=role_permissions, back_populates="roles")
    users = relationship("User", back_populates="role")


# --- UPDATED USER TABLE ---
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    steam_id = Column(String, unique=True, nullable=True)

    # The Foreign Key linking the user to their role
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    role = relationship("Role", back_populates="users")

    watchlist = relationship("TrackedItem", back_populates="owner")
    inventory = relationship("InventoryItem", back_populates="owner")


class SkinCatalog(Base):
    __tablename__ = "skin_catalog"

    id = Column(Integer, primary_key=True, index=True)
    # The official CS2 market name (e.g., "AK-47 | Redline (Field-Tested)")
    market_hash_name = Column(String, unique=True, index=True, nullable=False)
    icon_url = Column(String, nullable=True)
    weapon_type = Column(String)
    rarity = Column(String)

    tracked_by = relationship("TrackedItem", back_populates="skin_data")
    inventory_instances = relationship("InventoryItem", back_populates="skin_data")


class TrackedItem(Base):
    __tablename__ = "tracked_items"

    id = Column(Integer, primary_key=True, index=True)

    # Replaced target_price with max_price and max_float
    max_price = Column(Float)
    max_float = Column(Float, nullable=True)

    user_id = Column(Integer, ForeignKey("users.id"))
    skin_catalog_id = Column(Integer, ForeignKey("skin_catalog.id"))

    owner = relationship("User", back_populates="watchlist")
    skin_data = relationship("SkinCatalog", back_populates="tracked_by")


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(Integer, primary_key=True, index=True)

    # The unique CS2 instance ID
    steam_asset_id = Column(String, unique=True, index=True, nullable=True)

    float_value = Column(Float, nullable=True) # Usage index (0-1)
    paint_seed = Column(Integer, nullable=True)  # Pattern index (0-999)
    inspect_link = Column(String, nullable=True)
    acquired_price = Column(Float, default=0.0)

    user_id = Column(Integer, ForeignKey("users.id"))
    skin_catalog_id = Column(Integer, ForeignKey("skin_catalog.id"))

    owner = relationship("User", back_populates="inventory")
    skin_data = relationship("SkinCatalog", back_populates="inventory_instances")



class Log(Base):
    __tablename__ = "logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    group_id = Column(String)  # Admin or Normal User
    action_information = Column(String)  # e.g., "DELETED_SKIN_ID_4"
    timestamp = Column(String, default=lambda: datetime.now(timezone.utc).isoformat())

    # This column holds the EXACT string format the rubric asked for
    formatted_entry = Column(String)

    user = relationship("User")


class ObservationList(Base):
    __tablename__ = "observation_list"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)  # Unique so we don't list them twice
    reason = Column(String)
    detected_at = Column(String, default=lambda: datetime.now(timezone.utc).isoformat())

    user = relationship("User")