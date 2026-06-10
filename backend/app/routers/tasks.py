from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import Task, TaskComment, TaskStatus, TaskStatusHistory, User, UserRole
from ..permissions import assert_can_manage_task_payload, get_visible_task_or_403, require_admin
from ..schemas import CommentCreate, CommentOut, HistoryOut, TaskCreate, TaskDelete, TaskOut, TaskStatusUpdate, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


def visible_task_query(db: Session, user: User):
    query = db.query(Task).options(joinedload(Task.assignee), joinedload(Task.department), joinedload(Task.delay_reason))
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
):
    if status_value == TaskStatus.delayed and not delay_reason_id and not delay_reason_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delay reason is required when status is delayed")
    if status_value == TaskStatus.blocked and not hold_reason_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hold reason is required when status is blocked")
    if (
        task
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
        query = query.filter(Task.due_date < date.today(), Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]))
    return query.order_by(Task.due_date.asc(), Task.id.desc()).all()


@router.post("", response_model=TaskOut)
def create_task(payload: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    db.commit()
    db.refresh(task)
    return task


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_visible_task_or_403(db, task_id, current_user)


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
    validate_status_reasons(
        task,
        next_status,
        data.get("delay_reason_id", task.delay_reason_id),
        data.get("delay_reason_text", task.delay_reason_text),
        data.get("hold_reason_text", task.hold_reason_text),
        data.get("overrun_reason_text", task.overrun_reason_text),
    )
    old_status = task.status
    for key, value in data.items():
        setattr(task, key, value)
    apply_status_effects(task, old_status, task.status, current_user, db)
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
    return db.query(TaskComment).filter(TaskComment.task_id == task_id).order_by(TaskComment.created_at.desc()).all()


@router.get("/{task_id}/history", response_model=list[HistoryOut])
def list_history(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    get_visible_task_or_403(db, task_id, current_user)
    return db.query(TaskStatusHistory).filter(TaskStatusHistory.task_id == task_id).order_by(TaskStatusHistory.changed_at.desc()).all()
