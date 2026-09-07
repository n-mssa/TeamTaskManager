from datetime import date, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, joinedload

from ..models import Task, TaskComment, TaskStatus, User, UserRole


DELAY_CATEGORY_COEFFICIENTS = {
    "on_employee": 1.0,
    "shared": 0.5,
    "external": 0.0,
}
REPORT_TIME_ZONE = ZoneInfo("Asia/Amman")


def role_value(user: User):
    return getattr(user.role, "value", user.role)


def report_local_date(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(REPORT_TIME_ZONE).date()


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


def delay_hours_for_task(task: Task):
    if is_expected_time_complaint_accepted(task):
        return 0
    actual_hours = (task.elapsed_seconds or 0) / 3600
    expected_hours = (task.expected_minutes or 0) / 60
    return max(actual_hours - expected_hours, 0)


def is_expected_time_complaint_accepted(task: Task):
    return getattr(task, "expected_time_complaint_status", None) == "accepted"


def is_effectively_over_expected(task: Task):
    return task.is_over_expected and not is_expected_time_complaint_accepted(task)


def attributable_delay_hours_for_task(task: Task):
    delay_hours = delay_hours_for_task(task)
    if delay_hours <= 0:
        return 0
    if not task.overrun_reason_text:
        return delay_hours
    category = getattr(task.overrun_reason_category, "value", task.overrun_reason_category) or "on_employee"
    if not task.overrun_reason_approved:
        return delay_hours
    return delay_hours * DELAY_CATEGORY_COEFFICIENTS.get(category, 1.0)


def is_kpi_eligible(task: Task):
    if not task.self_created_approved:
        return False
    if task.status in {TaskStatus.pending, TaskStatus.cancelled}:
        return False
    return task.status == TaskStatus.done or (task.elapsed_seconds or 0) > 0 or task.is_over_expected


def task_row(task: Task):
    over_expected = is_effectively_over_expected(task)
    actual_hours = (task.elapsed_seconds or 0) / 3600
    expected_hours = (task.expected_minutes or 0) / 60
    delay_hours = delay_hours_for_task(task)
    category = getattr(task.overrun_reason_category, "value", task.overrun_reason_category) or "on_employee"
    attributable_delay_hours = attributable_delay_hours_for_task(task)

    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "assignee_id": task.assigned_to_user_id,
        "assignee": task.assignee.full_name_ar if task.assignee else "",
        "department": task.department.name_ar if task.department else "",
        "status": task.status.value,
        "priority": task.priority.value,
        "expected_minutes": task.expected_minutes,
        "assigned_date": task.due_date.isoformat(),
        "due_date": task.due_date.isoformat(),
        "elapsed_seconds": task.elapsed_seconds,
        "actual_hours": round(actual_hours, 2),
        "delay_hours": round(delay_hours, 2),
        "attributable_delay_hours": round(attributable_delay_hours, 2),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "is_late": over_expected,
        "is_overdue": bool(over_expected and task.status not in {TaskStatus.done, TaskStatus.cancelled}),
        "delay_reason": task.delay_reason.name_ar if task.delay_reason else None,
        "delay_reason_text": task.delay_reason_text,
        "overrun_reason_text": task.overrun_reason_text,
        "overrun_reason_category": category,
        "overrun_reason_approved": task.overrun_reason_approved,
        "expected_time_complaint_text": task.expected_time_complaint_text,
        "expected_time_complaint_at": task.expected_time_complaint_at.isoformat() if task.expected_time_complaint_at else None,
        "expected_time_complaint_status": task.expected_time_complaint_status,
        "production_issue_flagged": task.production_issue_flagged,
        "production_issue_reason": task.production_issue_reason,
        "production_issue_flagged_at": task.production_issue_flagged_at.isoformat() if task.production_issue_flagged_at else None,
        "self_created_approved": task.self_created_approved,
        "self_created_approved_by_user_id": task.self_created_approved_by_user_id,
        "self_created_approved_at": task.self_created_approved_at.isoformat() if task.self_created_approved_at else None,
        "comments": [
            {
                "id": comment.id,
                "comment_text": comment.comment_text,
                "created_at": comment.created_at.isoformat() if comment.created_at else None,
                "user": comment.user.full_name_ar if comment.user else "",
            }
            for comment in sorted(task.comments, key=lambda item: item.created_at.isoformat() if item.created_at else "")
        ],
    }


def kpi_summary(tasks: list[Task]):
    kpi_tasks = [task for task in tasks if is_kpi_eligible(task)]
    total_estimated_hours = sum((task.expected_minutes or 0) / 60 for task in kpi_tasks)
    total_actual_hours = sum((task.elapsed_seconds or 0) / 3600 for task in kpi_tasks)
    total_delay_hours = sum(delay_hours_for_task(task) for task in kpi_tasks)
    attributable_delay_hours = sum(attributable_delay_hours_for_task(task) for task in kpi_tasks)
    raw_delay_rate = (attributable_delay_hours / total_estimated_hours * 100) if total_estimated_hours else None
    delay_rate = min(raw_delay_rate, 100) if raw_delay_rate is not None else None
    return {
        "evaluated_tasks": len(kpi_tasks),
        "completed_tasks": sum(1 for task in kpi_tasks if task.status == TaskStatus.done),
        "total_estimated_hours": round(total_estimated_hours, 2),
        "total_actual_hours": round(total_actual_hours, 2),
        "overdue_tasks": sum(1 for task in kpi_tasks if is_effectively_over_expected(task)),
        "total_delay_hours": round(total_delay_hours, 2),
        "attributable_delay_hours": round(attributable_delay_hours, 2),
        "delay_rate": round(delay_rate, 2) if delay_rate is not None else None,
        "commitment_rate": round(max(0, 100 - delay_rate), 2) if delay_rate is not None else None,
    }


def summarize_tasks_by_employee(tasks: list[Task]):
    grouped = {}
    for task in tasks:
        employee = task.assignee.full_name_ar if task.assignee else ""
        current = grouped.setdefault(employee, {"done": 0, "in_progress": 0, "pending": 0, "blocked": 0, "delayed": 0, "expected_minutes": 0})
        if task.status == TaskStatus.done:
            current["done"] += 1
        if task.status == TaskStatus.in_progress:
            current["in_progress"] += 1
        if task.status == TaskStatus.pending:
            current["pending"] += 1
        if task.status == TaskStatus.blocked:
            current["blocked"] += 1
        if is_effectively_over_expected(task):
            current["delayed"] += 1
        current["expected_minutes"] += task.expected_minutes or 0

    return [
        {"employee": employee, **values}
        for employee, values in grouped.items()
    ]


def summarize_tasks_by_department(tasks: list[Task]):
    grouped = {}
    for task in tasks:
        department = task.department.name_ar if task.department else ""
        grouped[department] = grouped.get(department, 0) + 1
    return [{"department": department, "count": count} for department, count in grouped.items()]


def delay_reason_label(task: Task):
    if task.overrun_reason_text:
        return task.overrun_reason_text
    if task.delay_reason:
        return task.delay_reason.name_ar
    if task.delay_reason_text:
        return task.delay_reason_text
    return "سبب غير محدد"


def summarize_delay_reasons(tasks: list[Task]):
    grouped = {}
    for task in tasks:
        reason = delay_reason_label(task)
        grouped[reason] = grouped.get(reason, 0) + 1
    return [{"reason": reason, "count": count} for reason, count in grouped.items()]


def weekly_report(db: Session, current_user: User, start_date: date, end_date: date, department_id: int | None = None, user_id: int | None = None):
    base = scoped_tasks(db, current_user, department_id, user_id)
    all_tasks = base.options(
        joinedload(Task.assignee),
        joinedload(Task.department),
        joinedload(Task.delay_reason),
        joinedload(Task.comments).joinedload(TaskComment.user),
    ).all()
    available_users = allowed_report_users_query(db, current_user).filter(User.is_active.is_(True)).order_by(User.full_name_ar).all()
    completed = [task for task in all_tasks if task.status == TaskStatus.done and task.completed_at and start_date <= report_local_date(task.completed_at) <= end_date]
    delayed = [
        task
        for task in all_tasks
        if task.status == TaskStatus.delayed or (is_effectively_over_expected(task) and task.status not in {TaskStatus.done, TaskStatus.cancelled})
    ]
    delayed_ids = {task.id for task in delayed}
    pending_work = [
        task
        for task in all_tasks
        if task.status in {TaskStatus.pending, TaskStatus.in_progress, TaskStatus.blocked} and task.id not in delayed_ids
    ]
    completed_late = [task for task in completed if is_effectively_over_expected(task)]
    completed_in_period = completed

    kpi_tasks_by_id = {task.id: task for task in [*completed, *pending_work, *delayed]}
    report_tasks = list(kpi_tasks_by_id.values())
    delay_reason_tasks = list({task.id: task for task in [*completed_late, *delayed]}.values())

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "selected_user_id": user_id,
        "summary": {
            "created_this_week": len(completed_in_period),
            "completed_this_week": len(completed),
            "pending": sum(1 for task in all_tasks if task.status == TaskStatus.pending),
            "in_progress": sum(1 for task in all_tasks if task.status == TaskStatus.in_progress),
            "blocked": sum(1 for task in all_tasks if task.status == TaskStatus.blocked and task.id not in delayed_ids),
            "delayed": len(delayed),
            "completed_late": len(completed_late),
            "expected_minutes": sum(task.expected_minutes for task in [*completed, *pending_work, *delayed]),
        },
        "kpi": kpi_summary(list(kpi_tasks_by_id.values())),
        "completed_tasks": [task_row(task) for task in completed],
        "pending_in_progress_tasks": [task_row(task) for task in pending_work],
        "delayed_tasks": [task_row(task) for task in delayed],
        "by_department": summarize_tasks_by_department(report_tasks),
        "by_employee": summarize_tasks_by_employee(report_tasks),
        "delay_reasons": summarize_delay_reasons(delay_reason_tasks),
        "available_users": [
            {"id": user.id, "username": user.username, "full_name_ar": user.full_name_ar, "department_id": user.department_id}
            for user in available_users
        ],
    }
