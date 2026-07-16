import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import Notification, Task, TaskAttachment, TaskComment, TaskPriority, TaskStatus, TaskStatusHistory, User, UserRole
from ..permissions import assert_can_manage_task_payload, get_visible_task_or_403, require_admin
from ..schemas import CommentCreate, CommentOut, HistoryOut, TaskCreate, TaskDelete, TaskOut, TaskStatusUpdate, TaskUpdate
from ..services.storage import delete_objects, download_object, upload_object

router = APIRouter(prefix="/tasks", tags=["tasks"])

MAX_TASK_ATTACHMENTS = 3
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


def visible_task_query(db: Session, user: User):
    query = db.query(Task).options(
        joinedload(Task.assignee),
        joinedload(Task.department),
        joinedload(Task.delay_reason),
        joinedload(Task.attachments),
    )
    query = query.filter(Task.deleted_at.is_(None))
    if user.role == UserRole.employee:
        query = query.filter(Task.assigned_to_user_id == user.id)
    elif user.role == UserRole.manager:
        query = query.filter(Task.department_id == user.department_id)
    return query


def validate_status_reasons(
    task: Optional[Task],
    status_value: TaskStatus,
    delay_reason_id: Optional[int],
    delay_reason_text: Optional[str],
    hold_reason_text: Optional[str],
    overrun_reason_text: Optional[str],
    require_overrun_reason: bool = True,
):
    if status_value == TaskStatus.delayed and not delay_reason_id and not delay_reason_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delay reason is required when status is delayed")
    if status_value == TaskStatus.blocked and not hold_reason_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hold reason is required when status is blocked")
    if (
        task
        and require_overrun_reason
        and task.status == TaskStatus.in_progress
        and status_value != TaskStatus.in_progress
        and task.is_over_expected
        and not overrun_reason_text
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Overrun reason is required because the task exceeded its expected time")


def apply_status_effects(task: Task, old_status: Optional[TaskStatus], new_status: TaskStatus, changed_by: User, db: Session):
    now = datetime.now(timezone.utc)
    if old_status == TaskStatus.in_progress and new_status != TaskStatus.in_progress and task.timer_started_at:
        started_at = task.timer_started_at
        segment_end = now if started_at.tzinfo else datetime.utcnow()
        task.work_seconds = (task.work_seconds or 0) + max(0, int((segment_end - started_at).total_seconds()))
        task.timer_started_at = None
    if new_status == TaskStatus.in_progress and old_status != TaskStatus.in_progress:
        task.timer_started_at = now
        if not task.started_at:
            task.started_at = now
    if new_status == TaskStatus.done and old_status != TaskStatus.done:
        task.completed_at = now
    elif old_status == TaskStatus.done and new_status != TaskStatus.done:
        task.completed_at = None
    if old_status != new_status:
        reason_text = None
        if new_status == TaskStatus.blocked:
            reason_text = task.hold_reason_text
        elif new_status == TaskStatus.delayed:
            reason_text = task.delay_reason_text
        elif old_status == TaskStatus.in_progress and task.is_over_expected:
            reason_text = task.overrun_reason_text
        db.add(
            TaskStatusHistory(
                task=task,
                old_status=old_status,
                new_status=new_status,
                reason_text=reason_text,
                changed_by_user_id=changed_by.id,
            )
        )


def clean_filename(filename: str):
    name = Path(filename or "attachment").name.strip()
    return re.sub(r"[^A-Za-z0-9._ -]", "_", name)[:255] or "attachment"


def read_attachment_file(upload: UploadFile, task_id: int):
    original_filename = clean_filename(upload.filename or "attachment")
    stored_filename = f"tasks/{task_id}/{uuid4().hex}_{original_filename}"
    size = 0
    chunks = []
    while chunk := upload.file.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="يجب أن يكون حجم كل مرفق 10 ميجابايت أو أقل",
            )
        chunks.append(chunk)
    return original_filename, stored_filename, size, b"".join(chunks)


def notify_task_assigned(db: Session, task: Task, assignee_id: int):
    db.add(
        Notification(
            user_id=assignee_id,
            task=task,
            title="مهمة جديدة",
            message=f"تم إسناد مهمة جديدة: {task.title}",
            notification_type="task_assigned",
        )
    )


def create_task_record(payload: TaskCreate, db: Session, current_user: User):
    payload = payload.model_copy(
        update={
            "status": TaskStatus.pending,
            "delay_reason_id": None,
            "delay_reason_text": None,
            "hold_reason_text": None,
            "overrun_reason_text": None,
        }
    )
    assignee = db.query(User).filter(User.id == payload.assigned_to_user_id).first()
    if not assignee or not assignee.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee must be an active user")
    assert_can_manage_task_payload(current_user, payload.department_id, assignee)
    validate_status_reasons(
        None,
        payload.status,
        payload.delay_reason_id,
        payload.delay_reason_text,
        payload.hold_reason_text,
        payload.overrun_reason_text,
    )
    task = Task(**payload.model_dump(), created_by_user_id=current_user.id)
    apply_status_effects(task, None, task.status, current_user, db)
    db.add(task)
    notify_task_assigned(db, task, payload.assigned_to_user_id)
    return task


@router.get("", response_model=list[TaskOut])
def list_tasks(
    status_filter: Optional[TaskStatus] = Query(default=None, alias="status"),
    assigned_to: Optional[int] = None,
    department_id: Optional[int] = None,
    due_from: Optional[date] = None,
    due_to: Optional[date] = None,
    overdue: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = visible_task_query(db, current_user)
    if status_filter:
        query = query.filter(Task.status == status_filter)
    if assigned_to:
        query = query.filter(Task.assigned_to_user_id == assigned_to)
    if department_id:
        query = query.filter(Task.department_id == department_id)
    if due_from:
        query = query.filter(Task.due_date >= due_from)
    if due_to:
        query = query.filter(Task.due_date <= due_to)
    if overdue:
        tasks = query.order_by(Task.due_date.desc(), Task.id.desc()).all()
        return [
            task
            for task in tasks
            if task.status == TaskStatus.delayed
            or (task.is_over_expected and task.status not in {TaskStatus.done, TaskStatus.cancelled})
        ]
    return query.order_by(Task.due_date.desc(), Task.id.desc()).all()


@router.post("", response_model=TaskOut)
def create_task(payload: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = create_task_record(payload, db, current_user)
    db.commit()
    db.refresh(task)
    return task


@router.post("/with-attachments", response_model=TaskOut)
def create_task_with_attachments(
    title: str = Form(...),
    description: Optional[str] = Form(default=None),
    department_id: int = Form(...),
    assigned_to_user_id: int = Form(...),
    priority: TaskPriority = Form(default=TaskPriority.normal),
    status_value: TaskStatus = Form(default=TaskStatus.pending, alias="status"),
    expected_minutes: int = Form(...),
    due_date: Optional[date] = Form(default=None),
    delay_reason_id: Optional[int] = Form(default=None),
    delay_reason_text: Optional[str] = Form(default=None),
    hold_reason_text: Optional[str] = Form(default=None),
    overrun_reason_text: Optional[str] = Form(default=None),
    manager_notes: Optional[str] = Form(default=None),
    attachments: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if len(attachments) > MAX_TASK_ATTACHMENTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="يمكنك رفع 3 مرفقات كحد أقصى")
    payload = TaskCreate(
        title=title,
        description=description,
        department_id=department_id,
        assigned_to_user_id=assigned_to_user_id,
        priority=priority,
        status=status_value,
        expected_minutes=expected_minutes,
        due_date=due_date or date.today(),
        delay_reason_id=delay_reason_id,
        delay_reason_text=delay_reason_text,
        hold_reason_text=hold_reason_text,
        overrun_reason_text=overrun_reason_text,
        manager_notes=manager_notes,
    )
    task = create_task_record(payload, db, current_user)
    saved_files = []
    try:
        db.flush()
        for upload in attachments:
            original_filename, stored_filename, size, content = read_attachment_file(upload, task.id)
            upload_object(stored_filename, content, upload.content_type)
            saved_files.append(stored_filename)
            db.add(
                TaskAttachment(
                    task_id=task.id,
                    uploaded_by_user_id=current_user.id,
                    original_filename=original_filename,
                    stored_filename=stored_filename,
                    content_type=upload.content_type,
                    size_bytes=size,
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        delete_objects(saved_files)
        raise
    db.refresh(task)
    return task


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_visible_task_or_403(db, task_id, current_user)


@router.get("/{task_id}/attachments/{attachment_id}/download")
def download_attachment(task_id: int, attachment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    get_visible_task_or_403(db, task_id, current_user)
    attachment = db.query(TaskAttachment).filter(TaskAttachment.id == attachment_id, TaskAttachment.task_id == task_id).first()
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    content, content_type = download_object(attachment.stored_filename)
    safe_filename = attachment.original_filename.replace('"', "")
    return Response(
        content,
        media_type=attachment.content_type or content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.put("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, payload: TaskUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = get_visible_task_or_403(db, task_id, current_user)
    if current_user.role == UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employees can only update status/comments")
    data = payload.model_dump(exclude_unset=True)
    next_department = data.get("department_id", task.department_id)
    next_assignee_id = data.get("assigned_to_user_id", task.assigned_to_user_id)
    assignee = db.query(User).filter(User.id == next_assignee_id).first()
    if not assignee:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")
    assert_can_manage_task_payload(current_user, next_department, assignee)
    next_status = data.get("status", task.status)
    previous_assignee_id = task.assigned_to_user_id
    validate_status_reasons(
        task,
        next_status,
        data.get("delay_reason_id", task.delay_reason_id),
        data.get("delay_reason_text", task.delay_reason_text),
        data.get("hold_reason_text", task.hold_reason_text),
        data.get("overrun_reason_text", task.overrun_reason_text),
        current_user.id == task.assigned_to_user_id,
    )
    old_status = task.status
    for key, value in data.items():
        setattr(task, key, value)
    apply_status_effects(task, old_status, task.status, current_user, db)
    if task.assigned_to_user_id != previous_assignee_id:
        notify_task_assigned(db, task, task.assigned_to_user_id)
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{task_id}/status", response_model=TaskOut)
def update_status(task_id: int, payload: TaskStatusUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = get_visible_task_or_403(db, task_id, current_user)
    validate_status_reasons(
        task,
        payload.status,
        payload.delay_reason_id,
        payload.delay_reason_text,
        payload.hold_reason_text or task.hold_reason_text,
        payload.overrun_reason_text or task.overrun_reason_text,
        current_user.id == task.assigned_to_user_id,
    )
    old_status = task.status
    task.status = payload.status
    task.delay_reason_id = payload.delay_reason_id
    task.delay_reason_text = payload.delay_reason_text
    if payload.hold_reason_text:
        task.hold_reason_text = payload.hold_reason_text
    if payload.overrun_reason_text:
        task.overrun_reason_text = payload.overrun_reason_text
    apply_status_effects(task, old_status, payload.status, current_user, db)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, payload: TaskDelete, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deletion reason is required")
    task = get_visible_task_or_403(db, task_id, current_user)
    if task.status == TaskStatus.in_progress and task.timer_started_at:
        task.work_seconds = task.elapsed_seconds
        task.timer_started_at = None
    task.deleted_at = datetime.now(timezone.utc)
    task.deleted_by_user_id = current_user.id
    task.deletion_reason = reason
    db.commit()


@router.post("/{task_id}/comments", response_model=CommentOut)
def add_comment(task_id: int, payload: CommentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    get_visible_task_or_403(db, task_id, current_user)
    comment = TaskComment(task_id=task_id, user_id=current_user.id, comment_text=payload.comment_text)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.get("/{task_id}/comments", response_model=list[CommentOut])
def list_comments(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    get_visible_task_or_403(db, task_id, current_user)
    return (
        db.query(TaskComment)
        .options(joinedload(TaskComment.user))
        .filter(TaskComment.task_id == task_id)
        .order_by(TaskComment.created_at.desc())
        .all()
    )


@router.get("/{task_id}/history", response_model=list[HistoryOut])
def list_history(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    get_visible_task_or_403(db, task_id, current_user)
    return db.query(TaskStatusHistory).filter(TaskStatusHistory.task_id == task_id).order_by(TaskStatusHistory.changed_at.desc()).all()
