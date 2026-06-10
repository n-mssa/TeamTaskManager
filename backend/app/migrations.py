from sqlalchemy import text

from .database import engine


TASK_COLUMNS = {
    "timer_started_at": "TIMESTAMP WITH TIME ZONE",
    "work_seconds": "INTEGER NOT NULL DEFAULT 0",
    "hold_reason_text": "TEXT",
    "overrun_reason_text": "TEXT",
    "deleted_at": "TIMESTAMP WITH TIME ZONE",
    "deleted_by_user_id": "INTEGER REFERENCES users(id)",
    "deletion_reason": "TEXT",
}


def apply_migrations():
    with engine.begin() as connection:
        for column, definition in TASK_COLUMNS.items():
            connection.execute(text(f"ALTER TABLE tasks ADD COLUMN IF NOT EXISTS {column} {definition}"))
        connection.execute(
            text(
                "UPDATE tasks SET timer_started_at = CURRENT_TIMESTAMP "
                "WHERE status = 'in_progress' AND timer_started_at IS NULL"
            )
        )
        connection.execute(text("ALTER TABLE task_status_history ADD COLUMN IF NOT EXISTS reason_text TEXT"))
