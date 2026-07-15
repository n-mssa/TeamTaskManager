from datetime import date

from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session, joinedload

from ..models import Department, DelayReason, Task, TaskStatus, User, UserRole


def role_value(user: User):
    return getattr(user.role, "value", user.role)


def allowed_report_users_query(db: Session, current_user: User):
    query = db.query(User)
    current_role = role_value(current_user)
    if current_role == UserRole.employee.value:
        query = query.filter(User.id == current_user.id)
    elif current_role == UserRole.manager.value:
        query = query.filter(User.department_id == current_user.department_id)
    return query


def scoped_tasks(db: Session, current_user: User, department_id: int | None = None, user_id: int | None = None):
    query = db.query(Task).filter(Task.deleted_at.is_(None))
    current_role = role_value(current_user)
    if current_role == UserRole.employee.value:
        query = query.filter(Task.assigned_to_user_id == current_user.id)
    elif current_role == UserRole.manager.value:
        query = query.filter(Task.department_id == current_user.department_id)
    elif department_id:
        query = query.filter(Task.department_id == department_id)
    if user_id:
        allowed_user = allowed_report_users_query(db, current_user).filter(User.id == user_id).first()
        query = query.filter(Task.assigned_to_user_id == allowed_user.id) if allowed_user else query.filter(False)
    return query


def task_row(task: Task):
    over_expected = task.is_over_expected
    return {
        "id": task.id,
        "title": task.title,
        "assignee_id": task.assigned_to_user_id,
        "assignee": task.assignee.full_name_ar if task.assignee else "",
        "department": task.department.name_ar if task.department else "",
        "status": task.status.value,
        "priority": task.priority.value,
        "expected_minutes": task.expected_minutes,
        "assigned_date": task.due_date.isoformat(),
        "due_date": task.due_date.isoformat(),
        "elapsed_seconds": task.elapsed_seconds,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "is_late": over_expected,
        "is_overdue": bool(over_expected and task.status not in {TaskStatus.done, TaskStatus.cancelled}),
        "delay_reason": task.delay_reason.name_ar if task.delay_reason else None,
        "delay_reason_text": task.delay_reason_text,
    }


def weekly_report(db: Session, current_user: User, start_date: date, end_date: date, department_id: int | None = None, user_id: int | None = None):
    base = scoped_tasks(db, current_user, department_id, user_id)
    all_tasks = base.options(joinedload(Task.assignee), joinedload(Task.department), joinedload(Task.delay_reason)).all()
    available_users = allowed_report_users_query(db, current_user).filter(User.is_active.is_(True)).order_by(User.full_name_ar).all()
    completed = [task for task in all_tasks if task.status == TaskStatus.done and task.completed_at and start_date <= task.completed_at.date() <= end_date]
    delayed = [
        task
        for task in all_tasks
        if task.status == TaskStatus.delayed or (task.is_over_expected and task.status not in {TaskStatus.done, TaskStatus.cancelled})
    ]
    pending_work = [task for task in all_tasks if task.status in {TaskStatus.pending, TaskStatus.in_progress}]
    completed_late = [task for task in all_tasks if task.status == TaskStatus.done and task.is_over_expected]
    created_week = [task for task in all_tasks if start_date <= task.created_at.date() <= end_date]

    by_department = (
        base.join(Department)
        .with_entities(Department.name_ar, func.count(Task.id))
        .group_by(Department.name_ar)
        .all()
    )
    by_employee = (
        base.join(User, Task.assigned_to_user_id == User.id)
        .with_entities(
            User.full_name_ar,
            func.sum(case((Task.status == TaskStatus.done, 1), else_=0)),
            func.sum(case((Task.status == TaskStatus.in_progress, 1), else_=0)),
            func.sum(case((Task.status == TaskStatus.pending, 1), else_=0)),
            func.sum(case((Task.status == TaskStatus.delayed, 1), else_=0)),
            func.coalesce(func.sum(Task.expected_minutes), 0),
        )
        .group_by(User.full_name_ar)
        .all()
    )
    delay_reasons = (
        base.outerjoin(DelayReason)
        .filter(or_(Task.status == TaskStatus.delayed, Task.overrun_reason_text.isnot(None)))
        .with_entities(func.coalesce(DelayReason.name_ar, "سبب غير محدد"), func.count(Task.id))
        .group_by(DelayReason.name_ar)
        .all()
    )

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "selected_user_id": user_id,
        "summary": {
            "created_this_week": len(created_week),
            "completed_this_week": len(completed),
            "pending": sum(1 for task in all_tasks if task.status == TaskStatus.pending),
            "in_progress": sum(1 for task in all_tasks if task.status == TaskStatus.in_progress),
            "delayed": len(delayed),
            "completed_late": len(completed_late),
            "expected_minutes": sum(task.expected_minutes for task in all_tasks),
        },
        "completed_tasks": [task_row(task) for task in completed],
        "pending_in_progress_tasks": [task_row(task) for task in pending_work],
        "delayed_tasks": [task_row(task) for task in delayed],
        "by_department": [{"department": name, "count": count} for name, count in by_department],
        "by_employee": [
            {
                "employee": row[0],
                "done": int(row[1] or 0),
                "in_progress": int(row[2] or 0),
                "pending": int(row[3] or 0),
                "delayed": int(row[4] or 0),
                "expected_minutes": int(row[5] or 0),
            }
            for row in by_employee
        ],
        "delay_reasons": [{"reason": name, "count": count} for name, count in delay_reasons],
        "available_users": [
            {"id": user.id, "username": user.username, "full_name_ar": user.full_name_ar, "department_id": user.department_id}
            for user in available_users
        ],
    }
