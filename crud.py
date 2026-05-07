# crud.py
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
import models


def get_or_create_catalog_item(db: Session, name: str) -> models.SkinCatalog:
    """Checks if a skin blueprint exists. If not, creates a basic one."""
    skin = db.query(models.SkinCatalog).filter(models.SkinCatalog.market_hash_name == name).first()

    if not skin:
        skin = models.SkinCatalog(
            market_hash_name=name,
            weapon_type="Unknown",
            rarity="Unknown"
        )
        db.add(skin)
        db.commit()
        db.refresh(skin)

    return skin


def add_tracked_item(db: Session, user_id: int, name: str, max_price: float, max_float: float) -> models.TrackedItem:
    """Gets the blueprint, then adds it to the user's watchlist."""
    catalog_item = get_or_create_catalog_item(db, name)

    tracked_item = models.TrackedItem(
        user_id=user_id,
        skin_catalog_id=catalog_item.id,
        max_price=max_price,
        max_float=max_float
    )
    db.add(tracked_item)
    db.commit()
    db.refresh(tracked_item)

    return tracked_item


def log_user_action(db: Session, user: models.User, action: str):
    """Logs the action and checks for malevolent behavior."""

    # 1. Format the Log Entry exactly as the rubric demands
    role_name = user.role.name if user.role else "USER"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    formatted_string = f"{user.id}:{role_name}[ADMIN/USER] {action}:{timestamp}"

    # 2. Save the Log to the database
    new_log = models.Log(
        user_id=user.id,
        group_id=role_name,
        action_information=action,
        timestamp=timestamp,
        formatted_entry=formatted_string
    )
    db.add(new_log)
    db.commit()

    # --- STEALTH MALEVOLENT DETECTION ---
    # 3. Look at the user's last 5 logs.
    recent_logs = db.query(models.Log).filter(
        models.Log.user_id == user.id
    ).order_by(models.Log.id.desc()).limit(5).all()

    if len(recent_logs) == 5:
        # Check the time difference between the newest and 5th oldest log
        time_format = "%Y-%m-%d %H:%M:%S"
        newest_time = datetime.strptime(recent_logs[0].timestamp, time_format)
        oldest_time = datetime.strptime(recent_logs[-1].timestamp, time_format)

        # If 5 actions happened in less than 60 seconds, flag them!
        if (newest_time - oldest_time) < timedelta(seconds=60):

            # Check if they are already on the list
            already_flagged = db.query(models.ObservationList).filter(
                models.ObservationList.user_id == user.id
            ).first()

            if not already_flagged:
                flag = models.ObservationList(
                    user_id=user.id,
                    reason="Suspicious Activity: Spammed 5 actions in under 60 seconds."
                )
                db.add(flag)
                db.commit()
                print(f"SECURITY ALERT: User {user.username} added to Observation List!")