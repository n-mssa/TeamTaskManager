from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from .models import Task, User, UserRole


def require_admin(user: User):
    if user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


def require_manager_or_admin(user: User):
    if user.role not in {UserRole.admin, UserRole.manager}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager or admin only")


def can_access_task(user: User, task: Task) -> bool:
    if user.role == UserRole.admin:
        return True
    if user.role == UserRole.manager:
        return task.department_id == user.department_id
    return task.assigned_to_user_id == user.id


def get_visible_task_or_403(db: Session, task_id: int, user: User) -> Task:
    task = (
        db.query(Task)
        .options(joinedload(Task.assignee), joinedload(Task.department), joinedload(Task.delay_reason))
        .filter(Task.id == task_id, Task.deleted_at.is_(None))
        .first()
    )
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not can_access_task(user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Task is outside your permissions")
    return task


def assert_can_manage_task_payload(user: User, department_id: int, assigned_user: User):
    if user.role == UserRole.employee:
        if assigned_user.id != user.id or department_id != user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employees can create tasks only for themselves")
        return
    if user.role == UserRole.manager:
        if department_id != user.department_id or assigned_user.department_id != user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can assign only inside their department")
