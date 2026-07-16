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

USER_COLUMNS = {
    "theme_id": "VARCHAR(32) NOT NULL DEFAULT 'light'",
}

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_tasks_assignee_active_due ON tasks (assigned_to_user_id, due_date) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_tasks_department_active_due ON tasks (department_id, due_date) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_tasks_status_active_due ON tasks (status, due_date) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_tasks_created_active ON tasks (created_at) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_task_comments_task_created ON task_comments (task_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_task_history_task_changed ON task_status_history (task_id, changed_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_task_attachments_task_created ON task_attachments (task_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_notifications_user_read_created ON notifications (user_id, read_at, created_at DESC)",
]


def apply_migrations():
    with engine.begin() as connection:
        for column, definition in TASK_COLUMNS.items():
            connection.execute(text(f"ALTER TABLE tasks ADD COLUMN IF NOT EXISTS {column} {definition}"))
        for column, definition in USER_COLUMNS.items():
            connection.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {column} {definition}"))
        connection.execute(
            text(
                "UPDATE tasks SET timer_started_at = CURRENT_TIMESTAMP "
                "WHERE status = 'in_progress' AND timer_started_at IS NULL"
            )
        )
        connection.execute(
            text(
                "UPDATE tasks "
                "SET status = 'blocked', "
                "hold_reason_text = COALESCE(hold_reason_text, delay_reason_text, 'Moved from late bucket') "
                "WHERE status = 'delayed'"
            )
        )
        connection.execute(text("ALTER TABLE task_status_history ADD COLUMN IF NOT EXISTS reason_text TEXT"))
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS task_attachments ("
                "id SERIAL PRIMARY KEY, "
                "task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, "
                "uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id), "
                "original_filename VARCHAR(255) NOT NULL, "
                "stored_filename VARCHAR(255) NOT NULL UNIQUE, "
                "content_type VARCHAR(255), "
                "size_bytes INTEGER NOT NULL, "
                "created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS notifications ("
                "id SERIAL PRIMARY KEY, "
                "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, "
                "title VARCHAR(220) NOT NULL, "
                "message TEXT NOT NULL, "
                "notification_type VARCHAR(80) NOT NULL DEFAULT 'task_assigned', "
                "read_at TIMESTAMP WITH TIME ZONE, "
                "created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP"
                ")"
            )
        )
        for statement in INDEXES:
            connection.execute(text(statement))
