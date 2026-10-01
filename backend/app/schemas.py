from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from .models import DelayReasonCategory, TaskPriority, TaskStatus, UserRole


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
    is_restricted: bool = False


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(DepartmentBase):
    pass


class DepartmentOut(DepartmentBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recurring_tasks_enabled: bool = False
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
    theme_id: str = "light"


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


class ThemePreference(BaseModel):
    theme_id: str = Field(pattern="^(light|dark|blue|green|orange)$")


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
    due_date: date = Field(default_factory=date.today)
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
    overrun_reason_category: Optional[DelayReasonCategory] = None
    expected_time_complaint_text: Optional[str] = None


class DelayReviewUpdate(BaseModel):
    overrun_reason_category: DelayReasonCategory
    overrun_reason_approved: bool = True


class ExpectedTimeReviewUpdate(BaseModel):
    approved: bool = True
    expected_minutes: Optional[int] = Field(default=None, gt=0)


class ProductionIssueUpdate(BaseModel):
    flagged: bool = True
    reason: Optional[str] = None


class SelfCreatedApprovalUpdate(BaseModel):
    approved: bool = True


class AutoPauseCancel(BaseModel):
    paused_at: Optional[datetime] = None


class AutoPauseRun(BaseModel):
    reason: str = Field(min_length=1)
    overrun_reason_text: Optional[str] = None


class TaskDelete(BaseModel):
    reason: str = Field(min_length=1)


class TaskSplitCreate(BaseModel):
    current_label: str = Field(min_length=1, max_length=120)
    other_label: str = Field(min_length=1, max_length=120)
    current_expected_minutes: int = Field(gt=0)
    other_expected_minutes: int = Field(gt=0)
    other_assignee_id: int


class TaskAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    uploaded_by_user_id: int
    original_filename: str
    content_type: Optional[str]
    size_bytes: int
    attachment_kind: str = "general"
    created_at: datetime


class TaskOut(TaskBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_by_user_id: int
    started_at: Optional[datetime]
    timer_started_at: Optional[datetime]
    work_seconds: int
    elapsed_seconds: int
    is_over_expected: bool
    is_eod_overdue: bool = False
    has_sanad: bool = False
    shared_sanad_attachment: Optional[TaskAttachmentOut] = None
    recurring_template_id: Optional[int] = None
    recurrence_date: Optional[date] = None
    recurrence_frequency: Optional[str] = None
    billing_work_order_id: Optional[str] = None
    split_group_id: Optional[str] = None
    split_part: Optional[int] = None
    split_total: Optional[int] = None
    split_label: Optional[str] = None
    split_expected_minutes: Optional[int] = None
    completed_at: Optional[datetime]
    overrun_reason_category: DelayReasonCategory = DelayReasonCategory.on_employee
    overrun_reason_approved: bool = False
    expected_time_complaint_text: Optional[str] = None
    expected_time_complaint_at: Optional[datetime] = None
    expected_time_complaint_status: str = "none"
    production_issue_flagged: bool = False
    production_issue_reason: Optional[str] = None
    production_issue_flagged_by_user_id: Optional[int] = None
    production_issue_flagged_at: Optional[datetime] = None
    self_created_approved: bool = True
    self_created_approved_by_user_id: Optional[int] = None
    self_created_approved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    assignee: Optional[UserOut] = None
    department: Optional[DepartmentOut] = None
    delay_reason: Optional[DelayReasonOut] = None
    attachments: list[TaskAttachmentOut] = Field(default_factory=list)


class CommentCreate(BaseModel):
    comment_text: str


class CommentUpdate(BaseModel):
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


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    task_id: Optional[int]
    title: str
    message: str
    notification_type: str
    read_at: Optional[datetime]
    created_at: datetime


class ReportRequest(BaseModel):
    start_date: date
    end_date: date


class RecurringTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    department_id: int
    assigned_to_user_id: int
    priority: TaskPriority = TaskPriority.normal
    expected_minutes: int = Field(gt=0)
    manager_notes: Optional[str] = None
    frequency: str = Field(pattern="^(daily|monthly)$")
    start_date: date


class RecurringTaskUpdate(BaseModel):
    is_active: bool


class RecurringTaskOut(RecurringTaskCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    monthly_day: Optional[int] = None
    generation_hour: int
    is_active: bool
    created_by_user_id: int
    created_at: datetime
    updated_at: datetime
    assignee: Optional[UserOut] = None


class BillsImportRequest(BaseModel):
    pasted_text: str = Field(min_length=1, max_length=200_000)
    task_date: date
    expected_minutes: int = Field(default=10, gt=0, le=1440)


class BillsImportRow(BaseModel):
    row_number: int
    customer_rep: str = ""
    work_order_id: str = ""
    customer_name: str = ""
    material_name: str = ""
    title: str = ""
    status: str
    message: Optional[str] = None


class BillsImportResult(BaseModel):
    department_name: str
    assignee_name: str
    rows: list[BillsImportRow]
    ready_count: int
    duplicate_count: int
    invalid_count: int
    created_count: int = 0


class BillsImportHistoryRow(BaseModel):
    id: int
    title: str
    task_date: date
    work_order_id: str
    customer_rep: Optional[str] = None
    customer_name: str
    material_name: str
    status: TaskStatus
    created_at: datetime
    has_sanad: bool = False
    sanad_filename: Optional[str] = None


class BillsImportHistoryUpdate(BaseModel):
    task_date: date
    customer_rep: Optional[str] = Field(default=None, max_length=160)
    customer_name: str = Field(min_length=1, max_length=220)
    material_name: str = Field(min_length=1, max_length=320)


class BillsImportAssignee(BaseModel):
    id: int
    full_name_ar: str
    username: str


class BillsImportConfigOut(BaseModel):
    assigned_to_user_id: int
    assignee_name: str
    users: list[BillsImportAssignee]


class BillsImportConfigUpdate(BaseModel):
    assigned_to_user_id: int
