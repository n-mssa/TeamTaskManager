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

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_tasks_assignee_active_due ON tasks (assigned_to_user_id, due_date) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_tasks_department_active_due ON tasks (department_id, due_date) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_tasks_status_active_due ON tasks (status, due_date) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_tasks_created_active ON tasks (created_at) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_task_comments_task_created ON task_comments (task_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_task_history_task_changed ON task_status_history (task_id, changed_at DESC)",
]


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
        for statement in INDEXES:
            connection.execute(text(statement))
