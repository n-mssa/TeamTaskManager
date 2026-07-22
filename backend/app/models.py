from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, Column, Date, DateTime, Enum as SQLEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


class UserRole(str, Enum):
    admin = "admin"
    manager = "manager"
    employee = "employee"


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


class Task(Base):
    __tablename__ = "tasks"

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

    @property
    def elapsed_seconds(self):
        elapsed = self.work_seconds or 0
        if self.status == TaskStatus.in_progress and self.timer_started_at:
            now = datetime.now(self.timer_started_at.tzinfo) if self.timer_started_at.tzinfo else datetime.utcnow()
            elapsed += max(0, int((now - self.timer_started_at).total_seconds()))
        return elapsed

    @property
    def is_over_expected(self):
        return self.elapsed_seconds > self.expected_minutes * 60


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
