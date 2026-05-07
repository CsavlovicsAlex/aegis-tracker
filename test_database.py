# test_database.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
import crud
from database import Base

# 1. Set up a TEMPORARY test database (in-memory SQLite is extremely fast)
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# 2. Pytest Fixture: This runs BEFORE every single test
@pytest.fixture(scope="function")
def db_session():
    # Build the database tables from scratch
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()

    yield db

    # After the test finishes, close the connection and destroy the tables
    db.close()
    Base.metadata.drop_all(bind=engine)


# 3. THE TESTS

def test_create_catalog_item(db_session):
    """Test that we can create a blueprint in the database."""
    item = crud.get_or_create_catalog_item(db_session, "AK-47 | Redline (Field-Tested)")

    assert item.id is not None
    assert item.market_hash_name == "AK-47 | Redline (Field-Tested)"
    assert item.weapon_type == "Unknown"


def test_get_existing_catalog_item(db_session):
    """Test that the repository doesn't create duplicates (Testing the 'Get' part of Get-or-Create)."""
    # Create it once
    item1 = crud.get_or_create_catalog_item(db_session, "AWP | Dragon Lore (Factory New)")

    # Try to create it again
    item2 = crud.get_or_create_catalog_item(db_session, "AWP | Dragon Lore (Factory New)")

    # Prove they share the exact same database ID
    assert item1.id == item2.id


def test_add_tracked_item_relations(db_session):
    """Test the relational database aspect (Foreign Keys) works correctly."""

    # We need a dummy user first because of the Foreign Key constraint
    dummy_user = models.User(username="test_user")
    db_session.add(dummy_user)
    db_session.commit()

    # Add a tracked item
    tracked = crud.add_tracked_item(
        db=db_session,
        user_id=dummy_user.id,
        name="Glock-18 | Fade (Factory New)",
        max_price=150.50,
        max_float=0.01
    )

    assert tracked.id is not None
    assert tracked.max_price == 150.50
    # Prove the foreign key successfully linked the catalog blueprint!
    assert tracked.skin_data.market_hash_name == "Glock-18 | Fade (Factory New)"