from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..models import DelayReasonCategory, Notification, Task, TaskStatus, TaskStatusHistory


AMMAN_TIME_ZONE = ZoneInfo("Asia/Amman")
END_OF_DAY = time(hour=17)
END_OF_DAY_REASON = "END OF DAY"


def most_recent_end_of_day(now: datetime) -> datetime:
    local_now = now.astimezone(AMMAN_TIME_ZONE)
    cutoff_date = local_now.date() if local_now.time() >= END_OF_DAY else local_now.date() - timedelta(days=1)
    return datetime.combine(cutoff_date, END_OF_DAY, tzinfo=AMMAN_TIME_ZONE)


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def was_running_at_cutoff(task: Task, cutoff_utc: datetime) -> bool:
    reference = task.timer_started_at or task.started_at or task.created_at
    return reference is not None and as_utc(reference) <= cutoff_utc


def pause_missed_end_of_day_tasks(db: Session, now: datetime | None = None) -> list[Task]:
    current = now or datetime.now(timezone.utc)
    cutoff_utc = most_recent_end_of_day(current).astimezone(timezone.utc)
    running_tasks = (
        db.query(Task)
        .filter(Task.status == TaskStatus.in_progress, Task.deleted_at.is_(None))
        .all()
    )
    candidates = [task for task in running_tasks if was_running_at_cutoff(task, cutoff_utc)]
    if not candidates:
        return []

    split_group_ids = {task.split_group_id for task in candidates if task.split_group_id}
    split_groups = {}
    if split_group_ids:
        group_tasks = (
            db.query(Task)
            .filter(Task.split_group_id.in_(split_group_ids), Task.deleted_at.is_(None))
            .all()
        )
        for task in group_tasks:
            split_groups.setdefault(task.split_group_id, []).append(task)

    processed_groups = set()
    paused = []
    for task in candidates:
        if task.split_group_id:
            if task.split_group_id in processed_groups:
                continue
            processed_groups.add(task.split_group_id)
            members = split_groups.get(task.split_group_id, [task])
            running_members = [member for member in members if member.status == TaskStatus.in_progress]
            timer_starts = [as_utc(member.timer_started_at) for member in members if member.timer_started_at]
            shared_started = min(timer_starts) if timer_starts else None
            shared_work = max((member.work_seconds or 0 for member in members), default=0)
            if shared_started:
                shared_work += max(0, int((cutoff_utc - shared_started).total_seconds()))
            for member in members:
                member.work_seconds = shared_work
                member.timer_started_at = None
            for member in running_members:
                pause_task(member, cutoff_utc, db)
                paused.append(member)
        else:
            if task.timer_started_at:
                task.work_seconds = (task.work_seconds or 0) + max(
                    0,
                    int((cutoff_utc - as_utc(task.timer_started_at)).total_seconds()),
                )
            task.timer_started_at = None
            pause_task(task, cutoff_utc, db)
            paused.append(task)

    return paused


def pause_task(task: Task, cutoff_utc: datetime, db: Session):
    task.status = TaskStatus.blocked
    task.hold_reason_text = END_OF_DAY_REASON
    if not task.overrun_reason_text:
        task.overrun_reason_text = END_OF_DAY_REASON
        task.overrun_reason_category = DelayReasonCategory.external
    db.add(
        TaskStatusHistory(
            task_id=task.id,
            old_status=TaskStatus.in_progress,
            new_status=TaskStatus.blocked,
            reason_text=END_OF_DAY_REASON,
            changed_by_user_id=task.assigned_to_user_id,
            changed_at=cutoff_utc,
        )
    )
    db.add(
        Notification(
            user_id=task.assigned_to_user_id,
            task_id=task.id,
            title="تم إيقاف المهمة لنهاية اليوم",
            message=f"تم نقل المهمة إلى متوقف عند نهاية يوم العمل: {task.title}",
            notification_type="auto_paused",
        )
    )
