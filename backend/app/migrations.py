from sqlalchemy import text

from .database import engine


TASK_COLUMNS = {
    "timer_started_at": "TIMESTAMP WITH TIME ZONE",
    "work_seconds": "INTEGER NOT NULL DEFAULT 0",
    "hold_reason_text": "TEXT",
    "overrun_reason_text": "TEXT",
    "overrun_reason_category": "VARCHAR(32) NOT NULL DEFAULT 'on_employee'",
    "overrun_reason_approved": "BOOLEAN NOT NULL DEFAULT FALSE",
    "expected_time_complaint_text": "TEXT",
    "expected_time_complaint_at": "TIMESTAMP WITH TIME ZONE",
    "expected_time_complaint_status": "VARCHAR(32) NOT NULL DEFAULT 'none'",
    "production_issue_flagged": "BOOLEAN NOT NULL DEFAULT FALSE",
    "production_issue_reason": "TEXT",
    "production_issue_flagged_by_user_id": "INTEGER REFERENCES users(id)",
    "production_issue_flagged_at": "TIMESTAMP WITH TIME ZONE",
    "self_created_approved": "BOOLEAN NOT NULL DEFAULT TRUE",
    "self_created_approved_by_user_id": "INTEGER REFERENCES users(id)",
    "self_created_approved_at": "TIMESTAMP WITH TIME ZONE",
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


def column_exists(connection, table_name: str, column_name: str):
    return connection.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = current_schema() "
            "AND table_name = :table_name "
            "AND column_name = :column_name"
        ),
        {"table_name": table_name, "column_name": column_name},
    ).first() is not None


def add_column_if_missing(connection, table_name: str, column_name: str, definition: str):
    if column_exists(connection, table_name, column_name):
        return
    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"))


def apply_migrations():
    with engine.begin() as connection:
        for column, definition in TASK_COLUMNS.items():
            add_column_if_missing(connection, "tasks", column, definition)
        for column, definition in USER_COLUMNS.items():
            add_column_if_missing(connection, "users", column, definition)
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
        connection.execute(
            text(
                "UPDATE tasks "
                "SET expected_time_complaint_status = 'pending' "
                "WHERE expected_time_complaint_text IS NOT NULL "
                "AND expected_time_complaint_status = 'none'"
            )
        )
        add_column_if_missing(connection, "task_status_history", "reason_text", "TEXT")
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
