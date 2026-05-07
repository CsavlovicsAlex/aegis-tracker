# database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# 1. Define the SQLite database URL. 
# This tells SQLAlchemy to create a file named 'aegis_trade.db' in your current folder.
SQLALCHEMY_DATABASE_URL = "sqlite:///./aegis_track.db"

# 2. Create the Engine. 
# The engine is the central factory that manages connections to the DB.
# (The connect_args is a specific fix for SQLite in FastAPI to allow concurrent access)
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

# 3. Create a SessionLocal class. 
# Each instance of this class will be a temporary database session/connection.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 4. Create a Base class.
# All of our ORM models (tables) will inherit from this Base class so SQLAlchemy knows about them.
Base = declarative_base()

# 5. The Dependency Injection Generator
# We will use this in main.py. It opens a session, yields it to the endpoint, and closes it when done.
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
