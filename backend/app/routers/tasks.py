from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import Task, TaskComment, TaskStatus, TaskStatusHistory, User, UserRole
from ..permissions import assert_can_manage_task_payload, get_visible_task_or_403
from ..schemas import CommentCreate, CommentOut, HistoryOut, TaskCreate, TaskOut, TaskStatusUpdate, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


def visible_task_query(db: Session, user: User):
    query = db.query(Task).options(joinedload(Task.assignee), joinedload(Task.department), joinedload(Task.delay_reason))
    if user.role == UserRole.employee:
        query = query.filter(Task.assigned_to_user_id == user.id)
    elif user.role == UserRole.manager:
        query = query.filter(Task.department_id == user.department_id)
    return query


def validate_delayed(status_value: TaskStatus, delay_reason_id: Optional[int], delay_reason_text: Optional[str]):
    if status_value == TaskStatus.delayed and not delay_reason_id and not delay_reason_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delay reason is required when status is delayed")


def apply_status_effects(task: Task, old_status: Optional[TaskStatus], new_status: TaskStatus, changed_by: User, db: Session):
    if new_status == TaskStatus.in_progress and not task.started_at:
        task.started_at = datetime.utcnow()
    if new_status == TaskStatus.done and not task.completed_at:
        task.completed_at = datetime.utcnow()
    if old_status != new_status:
        db.add(TaskStatusHistory(task=task, old_status=old_status, new_status=new_status, changed_by_user_id=changed_by.id))


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
    validate_delayed(payload.status, payload.delay_reason_id, payload.delay_reason_text)
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
    validate_delayed(next_status, data.get("delay_reason_id", task.delay_reason_id), data.get("delay_reason_text", task.delay_reason_text))
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
    validate_delayed(payload.status, payload.delay_reason_id, payload.delay_reason_text)
    old_status = task.status
    task.status = payload.status
    task.delay_reason_id = payload.delay_reason_id
    task.delay_reason_text = payload.delay_reason_text
    apply_status_effects(task, old_status, payload.status, current_user, db)
    db.commit()
    db.refresh(task)
    return task


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
