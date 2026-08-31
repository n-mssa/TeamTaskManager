import unittest
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from app.models import Task, TaskStatus, User
from app.routers.tasks import apply_status_effects, validate_status_reasons, validate_status_transition
from app.services.reports import delay_hours_for_task, is_effectively_over_expected, kpi_summary


class FakeSession:
    def __init__(self):
        self.items = []

    def add(self, item):
        self.items.append(item)


def running_task():
    return Task(
        id=999,
        title="Lifecycle test",
        department_id=1,
        assigned_to_user_id=1,
        created_by_user_id=1,
        status=TaskStatus.in_progress,
        expected_minutes=1,
        due_date=date.today(),
        work_seconds=0,
        timer_started_at=datetime.now(timezone.utc) - timedelta(seconds=125),
    )


class TaskLifecycleTests(unittest.TestCase):
    def test_overrun_reason_is_required_when_leaving_in_progress(self):
        with self.assertRaises(HTTPException):
            validate_status_reasons(running_task(), TaskStatus.done, None, None, None, None)

    def test_overrun_reason_is_not_required_for_non_assignee_manager_move(self):
        validate_status_reasons(running_task(), TaskStatus.done, None, None, None, None, require_overrun_reason=False)

    def test_hold_reason_is_required_for_blocked_status(self):
        with self.assertRaises(HTTPException):
            validate_status_reasons(running_task(), TaskStatus.blocked, None, None, None, "Overrun reason")

    def test_timer_accumulates_when_leaving_in_progress(self):
        task = running_task()
        session = FakeSession()

        apply_status_effects(task, TaskStatus.in_progress, TaskStatus.blocked, User(id=1), session)

        self.assertIsNone(task.timer_started_at)
        self.assertGreaterEqual(task.work_seconds, 125)
        self.assertEqual(len(session.items), 1)

    def test_timer_resumes_from_accumulated_time(self):
        task = running_task()
        task.work_seconds = 90
        session = FakeSession()

        apply_status_effects(task, TaskStatus.in_progress, TaskStatus.pending, User(id=1), session)
        paused_seconds = task.work_seconds
        task.status = TaskStatus.pending

        apply_status_effects(task, TaskStatus.pending, TaskStatus.in_progress, User(id=1), session)

        self.assertGreaterEqual(paused_seconds, 215)
        self.assertEqual(task.work_seconds, paused_seconds)
        self.assertIsNotNone(task.timer_started_at)

    def test_task_cannot_move_back_to_pending_after_work_starts(self):
        with self.assertRaises(HTTPException):
            validate_status_transition(running_task(), TaskStatus.pending)

    def test_pending_task_can_remain_pending(self):
        task = running_task()
        task.status = TaskStatus.pending

        validate_status_transition(task, TaskStatus.pending)

    def test_accepted_time_complaint_removes_kpi_delay(self):
        task = Task(
            id=1000,
            title="Accepted complaint",
            department_id=1,
            assigned_to_user_id=1,
            created_by_user_id=1,
            status=TaskStatus.done,
            expected_minutes=60,
            due_date=date.today(),
            work_seconds=90 * 60,
            expected_time_complaint_text="Expected time was too low",
            expected_time_complaint_status="accepted",
        )

        summary = kpi_summary([task])

        self.assertFalse(is_effectively_over_expected(task))
        self.assertEqual(delay_hours_for_task(task), 0)
        self.assertEqual(summary["overdue_tasks"], 0)
        self.assertEqual(summary["attributable_delay_hours"], 0)
        self.assertEqual(summary["commitment_rate"], 100)


if __name__ == "__main__":
    unittest.main()
