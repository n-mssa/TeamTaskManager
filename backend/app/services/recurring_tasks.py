import calendar
import logging
import threading
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import Notification, RecurringTaskTemplate, Task, TaskStatus, TaskStatusHistory, User


AMMAN_TIME_ZONE = ZoneInfo("Asia/Amman")
SCHEDULER_INTERVAL_SECONDS = 60
_stop_event = threading.Event()
_scheduler_thread = None
logger = logging.getLogger(__name__)


def is_template_due(template: RecurringTaskTemplate, target_date: date) -> bool:
    if not template.is_active or target_date < template.start_date:
        return False
    if template.frequency == "daily":
        return target_date.weekday() != 4
    if template.frequency == "monthly":
        last_day = calendar.monthrange(target_date.year, target_date.month)[1]
        return target_date.day == min(template.monthly_day or template.start_date.day, last_day)
    return False


def generated_title(title: str, target_date: date) -> str:
    suffix = target_date.strftime("%d-%m-%Y")
    return f"{title[:220 - len(suffix) - 3]} - {suffix}"


def generate_due_recurring_tasks(db: Session, now: datetime | None = None) -> list[Task]:
    local_now = now.astimezone(AMMAN_TIME_ZONE) if now else datetime.now(AMMAN_TIME_ZONE)
    target_date = local_now.date()
    templates = (
        db.query(RecurringTaskTemplate)
        .filter(
            RecurringTaskTemplate.is_active.is_(True),
            RecurringTaskTemplate.start_date <= target_date,
            RecurringTaskTemplate.generation_hour <= local_now.hour,
        )
        .all()
    )
    generated = []
    for template in templates:
        if not is_template_due(template, target_date):
            continue
        exists = db.query(Task.id).filter(
            Task.recurring_template_id == template.id,
            Task.recurrence_date == target_date,
        ).first()
        if exists:
            continue
        assignee = db.query(User).filter(User.id == template.assigned_to_user_id, User.is_active.is_(True)).first()
        if not assignee:
            continue
        task = Task(
            title=generated_title(template.title, target_date),
            description=template.description,
            department_id=template.department_id,
            assigned_to_user_id=template.assigned_to_user_id,
            created_by_user_id=template.created_by_user_id,
            priority=template.priority,
            status=TaskStatus.pending,
            expected_minutes=template.expected_minutes,
            due_date=target_date,
            manager_notes=template.manager_notes,
            recurring_template_id=template.id,
            recurrence_date=target_date,
            recurrence_frequency=template.frequency,
        )
        db.add(task)
        db.flush()
        db.add(TaskStatusHistory(task_id=task.id, old_status=None, new_status=TaskStatus.pending, changed_by_user_id=template.created_by_user_id))
        db.add(
            Notification(
                user_id=template.assigned_to_user_id,
                task_id=task.id,
                title="مهمة دورية جديدة",
                message=f"تم إسناد مهمة دورية جديدة: {task.title}",
                notification_type="recurring_task_assigned",
            )
        )
        generated.append(task)
    return generated


def run_recurring_generation():
    db = SessionLocal()
    try:
        generate_due_recurring_tasks(db)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Recurring task generation failed")
    finally:
        db.close()


def _scheduler_loop():
    run_recurring_generation()
    while not _stop_event.wait(SCHEDULER_INTERVAL_SECONDS):
        run_recurring_generation()


def start_recurring_scheduler():
    global _scheduler_thread
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    _stop_event.clear()
    _scheduler_thread = threading.Thread(target=_scheduler_loop, name="recurring-task-scheduler", daemon=True)
    _scheduler_thread.start()


def stop_recurring_scheduler():
    _stop_event.set()
    if _scheduler_thread and _scheduler_thread.is_alive():
        _scheduler_thread.join(timeout=2)
