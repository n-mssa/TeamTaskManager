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
    "recurring_template_id": "INTEGER REFERENCES recurring_task_templates(id)",
    "recurrence_date": "DATE",
    "recurrence_frequency": "VARCHAR(16)",
    "billing_import_key": "VARCHAR(64)",
    "billing_customer_rep": "VARCHAR(160)",
    "billing_work_order_id": "VARCHAR(80)",
    "billing_customer_name": "VARCHAR(220)",
    "billing_material_name": "VARCHAR(320)",
    "split_group_id": "VARCHAR(36)",
    "split_part": "INTEGER",
    "split_total": "INTEGER",
    "split_label": "VARCHAR(120)",
    "split_expected_minutes": "INTEGER",
}

USER_COLUMNS = {
    "theme_id": "VARCHAR(32) NOT NULL DEFAULT 'light'",
}

DEPARTMENT_COLUMNS = {
    "is_restricted": "BOOLEAN NOT NULL DEFAULT FALSE",
    "recurring_tasks_enabled": "BOOLEAN NOT NULL DEFAULT FALSE",
    "billing_assignee_id": "INTEGER REFERENCES users(id)",
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
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_task_recurring_occurrence ON tasks (recurring_template_id, recurrence_date) WHERE recurring_template_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_billing_import_key ON tasks (billing_import_key) WHERE billing_import_key IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_tasks_split_group ON tasks (split_group_id) WHERE split_group_id IS NOT NULL",
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
    if engine.dialect.name == "postgresql":
        # PostgreSQL requires a newly added enum value to be committed before use.
        with engine.begin() as connection:
            connection.execute(text("ALTER TYPE public.userrole ADD VALUE IF NOT EXISTS 'super_admin'"))
            connection.execute(text("ALTER TYPE public.userrole ADD VALUE IF NOT EXISTS 'bills_user'"))

    with engine.begin() as connection:
        for column, definition in TASK_COLUMNS.items():
            add_column_if_missing(connection, "tasks", column, definition)
        for column, definition in USER_COLUMNS.items():
            add_column_if_missing(connection, "users", column, definition)
        for column, definition in DEPARTMENT_COLUMNS.items():
            add_column_if_missing(connection, "departments", column, definition)
        connection.execute(
            text(
                "UPDATE departments SET recurring_tasks_enabled = TRUE "
                "WHERE LOWER(COALESCE(name_en, '')) = 'finance' OR name_ar = 'المالية'"
            )
        )
        connection.execute(
            text(
                "UPDATE users SET role = 'admin' "
                "WHERE role = 'super_admin' AND LOWER(username) <> 'superadmin'"
            )
        )
        connection.execute(
            text(
                "UPDATE tasks SET timer_started_at = CURRENT_TIMESTAMP "
                "WHERE status = 'in_progress' AND timer_started_at IS NULL"
            )
        )
        if engine.dialect.name == "postgresql":
            connection.execute(
                text(
                    "WITH split_timer_state AS ("
                    "SELECT split_group_id, MAX(COALESCE(work_seconds, 0)) AS shared_work_seconds, "
                    "CASE WHEN MAX(COALESCE(split_expected_minutes, 0)) > 0 "
                    "THEN MAX(split_expected_minutes) ELSE SUM(expected_minutes) END AS shared_expected_minutes, "
                    "MIN(timer_started_at) FILTER (WHERE status = 'in_progress') AS shared_started_at, "
                    "BOOL_OR(status = 'in_progress') AS is_running "
                    "FROM tasks WHERE split_group_id IS NOT NULL AND deleted_at IS NULL GROUP BY split_group_id"
                    ") UPDATE tasks AS task SET "
                    "work_seconds = state.shared_work_seconds, "
                    "expected_minutes = state.shared_expected_minutes, "
                    "split_expected_minutes = state.shared_expected_minutes, "
                    "timer_started_at = CASE WHEN state.is_running "
                    "THEN COALESCE(state.shared_started_at, CURRENT_TIMESTAMP) ELSE NULL END "
                    "FROM split_timer_state AS state WHERE task.split_group_id = state.split_group_id"
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
        add_column_if_missing(connection, "task_attachments", "attachment_kind", "VARCHAR(32) NOT NULL DEFAULT 'general'")
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
