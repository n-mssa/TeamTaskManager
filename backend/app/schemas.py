from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from .models import TaskPriority, TaskStatus, UserRole


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    username: str
    password: str


class DepartmentBase(BaseModel):
    name_ar: str
    name_en: Optional[str] = None
    manager_id: Optional[int] = None


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(DepartmentBase):
    pass


class DepartmentOut(DepartmentBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class UserBase(BaseModel):
    username: str
    full_name_ar: str
    full_name_en: Optional[str] = None
    email: Optional[str] = None
    role: UserRole
    department_id: Optional[int] = None
    is_active: bool = True


class UserCreate(UserBase):
    password: str = Field(min_length=4)


class UserUpdate(BaseModel):
    username: Optional[str] = None
    full_name_ar: Optional[str] = None
    full_name_en: Optional[str] = None
    email: Optional[str] = None
    role: Optional[UserRole] = None
    department_id: Optional[int] = None
    is_active: Optional[bool] = None


class PasswordReset(BaseModel):
    password: str = Field(min_length=4)


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class DelayReasonBase(BaseModel):
    name_ar: str
    name_en: Optional[str] = None
    is_active: bool = True


class DelayReasonCreate(DelayReasonBase):
    pass


class DelayReasonUpdate(BaseModel):
    name_ar: Optional[str] = None
    name_en: Optional[str] = None
    is_active: Optional[bool] = None


class DelayReasonOut(DelayReasonBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    department_id: int
    assigned_to_user_id: int
    priority: TaskPriority = TaskPriority.normal
    status: TaskStatus = TaskStatus.pending
    expected_minutes: int = Field(gt=0)
    due_date: date
    delay_reason_id: Optional[int] = None
    delay_reason_text: Optional[str] = None
    hold_reason_text: Optional[str] = None
    overrun_reason_text: Optional[str] = None
    manager_notes: Optional[str] = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    department_id: Optional[int] = None
    assigned_to_user_id: Optional[int] = None
    priority: Optional[TaskPriority] = None
    status: Optional[TaskStatus] = None
    expected_minutes: Optional[int] = Field(default=None, gt=0)
    due_date: Optional[date] = None
    delay_reason_id: Optional[int] = None
    delay_reason_text: Optional[str] = None
    hold_reason_text: Optional[str] = None
    overrun_reason_text: Optional[str] = None
    manager_notes: Optional[str] = None


class TaskStatusUpdate(BaseModel):
    status: TaskStatus
    delay_reason_id: Optional[int] = None
    delay_reason_text: Optional[str] = None
    hold_reason_text: Optional[str] = None
    overrun_reason_text: Optional[str] = None


class TaskDelete(BaseModel):
    reason: str = Field(min_length=1)


class TaskOut(TaskBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_by_user_id: int
    started_at: Optional[datetime]
    timer_started_at: Optional[datetime]
    work_seconds: int
    elapsed_seconds: int
    is_over_expected: bool
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    assignee: Optional[UserOut] = None
    department: Optional[DepartmentOut] = None
    delay_reason: Optional[DelayReasonOut] = None


class CommentCreate(BaseModel):
    comment_text: str


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    user_id: int
    comment_text: str
    created_at: datetime
    user: Optional[UserOut] = None


class HistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    old_status: Optional[TaskStatus]
    new_status: TaskStatus
    reason_text: Optional[str]
    changed_by_user_id: int
    changed_at: datetime


class ReportRequest(BaseModel):
    start_date: date
    end_date: date
