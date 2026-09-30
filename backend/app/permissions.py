from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from .models import Department, Task, User, UserRole


ADMIN_ROLES = {UserRole.super_admin, UserRole.admin}
MANAGEMENT_ROLES = {UserRole.super_admin, UserRole.admin, UserRole.manager}


def is_super_admin(user: User) -> bool:
    return user.role == UserRole.super_admin


def require_admin(user: User):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


def require_super_admin(user: User):
    if not is_super_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin only")


def require_manager_or_admin(user: User):
    if user.role not in MANAGEMENT_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager or admin only")


def can_access_task(user: User, task: Task) -> bool:
    if user.role == UserRole.super_admin:
        return True
    if user.role == UserRole.admin:
        return bool(task.department and not task.department.is_restricted)
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


def assert_can_manage_task_payload(db: Session, user: User, department_id: int, assigned_user: User):
    if user.role == UserRole.employee:
        if assigned_user.id != user.id or department_id != user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employees can create tasks only for themselves")
        return
    if user.role == UserRole.manager:
        if department_id != user.department_id or assigned_user.department_id != user.department_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can assign only inside their department")
        return
    if user.role == UserRole.admin:
        department = db.query(Department).filter(Department.id == department_id).first()
        if not department:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department not found")
        assigned_department = db.query(Department).filter(Department.id == assigned_user.department_id).first()
        if department.is_restricted or (assigned_department and assigned_department.is_restricted):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This department is restricted to its manager and the super admin")
