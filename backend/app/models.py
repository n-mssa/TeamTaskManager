from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, Column, Date, DateTime, Enum as SQLEnum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


class UserRole(str, Enum):
    super_admin = "super_admin"
    admin = "admin"
    manager = "manager"
    employee = "employee"
    bills_user = "bills_user"


class TaskPriority(str, Enum):
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


class TaskStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    blocked = "blocked"
    delayed = "delayed"
    done = "done"
    cancelled = "cancelled"


class DelayReasonCategory(str, Enum):
    on_employee = "on_employee"
    shared = "shared"
    external = "external"


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    name_ar = Column(String(160), nullable=False, unique=True)
    name_en = Column(String(160), nullable=True)
    manager_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_restricted = Column(Boolean, default=False, nullable=False)
    recurring_tasks_enabled = Column(Boolean, default=False, nullable=False)
    billing_assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    users = relationship("User", back_populates="department", foreign_keys="User.department_id")
    manager = relationship("User", foreign_keys=[manager_id], post_update=True)
    tasks = relationship("Task", back_populates="department")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(80), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name_ar = Column(String(160), nullable=False)
    full_name_en = Column(String(160), nullable=True)
    email = Column(String(255), nullable=True)
    role = Column(SQLEnum(UserRole), nullable=False, default=UserRole.employee)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    theme_id = Column(String(32), nullable=False, default="light")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    department = relationship("Department", back_populates="users", foreign_keys=[department_id])
    assigned_tasks = relationship("Task", back_populates="assignee", foreign_keys="Task.assigned_to_user_id")
    created_tasks = relationship("Task", back_populates="creator", foreign_keys="Task.created_by_user_id")


class DelayReason(Base):
    __tablename__ = "delay_reasons"

    id = Column(Integer, primary_key=True, index=True)
    name_ar = Column(String(180), nullable=False, unique=True)
    name_en = Column(String(180), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)


class RecurringTaskTemplate(Base):
    __tablename__ = "recurring_task_templates"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(220), nullable=False)
    description = Column(Text, nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    assigned_to_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    priority = Column(SQLEnum(TaskPriority), nullable=False, default=TaskPriority.normal)
    expected_minutes = Column(Integer, nullable=False)
    manager_notes = Column(Text, nullable=True)
    frequency = Column(String(16), nullable=False)
    start_date = Column(Date, nullable=False)
    monthly_day = Column(Integer, nullable=True)
    generation_hour = Column(Integer, nullable=False, default=8)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    department = relationship("Department")
    assignee = relationship("User", foreign_keys=[assigned_to_user_id])
    creator = relationship("User", foreign_keys=[created_by_user_id])


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (UniqueConstraint("recurring_template_id", "recurrence_date", name="uq_task_recurring_occurrence"),)

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(220), nullable=False)
    description = Column(Text, nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    assigned_to_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    priority = Column(SQLEnum(TaskPriority), nullable=False, default=TaskPriority.normal)
    status = Column(SQLEnum(TaskStatus), nullable=False, default=TaskStatus.pending)
    expected_minutes = Column(Integer, nullable=False)
    due_date = Column(Date, nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    timer_started_at = Column(DateTime(timezone=True), nullable=True)
    work_seconds = Column(Integer, nullable=False, default=0)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    delay_reason_id = Column(Integer, ForeignKey("delay_reasons.id"), nullable=True)
    delay_reason_text = Column(Text, nullable=True)
    hold_reason_text = Column(Text, nullable=True)
    overrun_reason_text = Column(Text, nullable=True)
    overrun_reason_category = Column(SQLEnum(DelayReasonCategory), nullable=False, default=DelayReasonCategory.on_employee)
    overrun_reason_approved = Column(Boolean, default=False, nullable=False)
    expected_time_complaint_text = Column(Text, nullable=True)
    expected_time_complaint_at = Column(DateTime(timezone=True), nullable=True)
    expected_time_complaint_status = Column(String(32), nullable=False, default="none")
    production_issue_flagged = Column(Boolean, default=False, nullable=False)
    production_issue_reason = Column(Text, nullable=True)
    production_issue_flagged_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    production_issue_flagged_at = Column(DateTime(timezone=True), nullable=True)
    self_created_approved = Column(Boolean, default=True, nullable=False)
    self_created_approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    self_created_approved_at = Column(DateTime(timezone=True), nullable=True)
    manager_notes = Column(Text, nullable=True)
    recurring_template_id = Column(Integer, ForeignKey("recurring_task_templates.id"), nullable=True)
    recurrence_date = Column(Date, nullable=True)
    recurrence_frequency = Column(String(16), nullable=True)
    billing_import_key = Column(String(64), nullable=True, unique=True)
    billing_customer_rep = Column(String(160), nullable=True)
    billing_work_order_id = Column(String(80), nullable=True)
    billing_customer_name = Column(String(220), nullable=True)
    billing_material_name = Column(String(320), nullable=True)
    split_group_id = Column(String(36), nullable=True, index=True)
    split_part = Column(Integer, nullable=True)
    split_total = Column(Integer, nullable=True)
    split_label = Column(String(120), nullable=True)
    split_expected_minutes = Column(Integer, nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    deletion_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    department = relationship("Department", back_populates="tasks")
    assignee = relationship("User", back_populates="assigned_tasks", foreign_keys=[assigned_to_user_id])
    creator = relationship("User", back_populates="created_tasks", foreign_keys=[created_by_user_id])
    delay_reason = relationship("DelayReason")
    deleted_by = relationship("User", foreign_keys=[deleted_by_user_id])
    production_issue_flagged_by = relationship("User", foreign_keys=[production_issue_flagged_by_user_id])
    self_created_approved_by = relationship("User", foreign_keys=[self_created_approved_by_user_id])
    comments = relationship("TaskComment", back_populates="task", cascade="all, delete-orphan")
    history = relationship("TaskStatusHistory", back_populates="task", cascade="all, delete-orphan")
    attachments = relationship("TaskAttachment", back_populates="task", cascade="all, delete-orphan")
    recurring_template = relationship("RecurringTaskTemplate")

    @property
    def elapsed_seconds(self):
        elapsed = self.work_seconds or 0
        if self.status == TaskStatus.in_progress and self.timer_started_at:
            now = datetime.now(self.timer_started_at.tzinfo) if self.timer_started_at.tzinfo else datetime.utcnow()
            elapsed += max(0, int((now - self.timer_started_at).total_seconds()))
        return elapsed

    @property
    def is_over_expected(self):
        expected_minutes = self.split_expected_minutes or self.expected_minutes
        return self.elapsed_seconds > expected_minutes * 60

    @property
    def is_eod_overdue(self):
        if self.recurrence_frequency != "daily" or not self.recurrence_date:
            return False
        if self.status in {TaskStatus.done, TaskStatus.cancelled}:
            return False
        from zoneinfo import ZoneInfo

        now = datetime.now(ZoneInfo("Asia/Amman"))
        return now.date() > self.recurrence_date or (now.date() == self.recurrence_date and now.hour >= 17)

    @property
    def shared_sanad_attachment(self):
        own_sanad = next((attachment for attachment in self.attachments if attachment.attachment_kind == "sanad"), None)
        return own_sanad or getattr(self, "_shared_sanad_attachment", None)

    @property
    def has_sanad(self):
        return self.shared_sanad_attachment is not None


class TaskComment(Base):
    __tablename__ = "task_comments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    comment_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    task = relationship("Task", back_populates="comments")
    user = relationship("User")


class TaskAttachment(Base):
    __tablename__ = "task_attachments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    uploaded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    original_filename = Column(String(255), nullable=False)
    stored_filename = Column(String(255), nullable=False, unique=True)
    content_type = Column(String(255), nullable=True)
    size_bytes = Column(Integer, nullable=False)
    attachment_kind = Column(String(32), nullable=False, default="general")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    task = relationship("Task", back_populates="attachments")
    uploaded_by = relationship("User")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    title = Column(String(220), nullable=False)
    message = Column(Text, nullable=False)
    notification_type = Column(String(80), nullable=False, default="task_assigned")
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User")
    task = relationship("Task")


class TaskStatusHistory(Base):
    __tablename__ = "task_status_history"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    old_status = Column(SQLEnum(TaskStatus), nullable=True)
    new_status = Column(SQLEnum(TaskStatus), nullable=False)
    reason_text = Column(Text, nullable=True)
    changed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    changed_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    task = relationship("Task", back_populates="history")
    changed_by = relationship("User")
