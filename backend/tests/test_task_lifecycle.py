import unittest
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Department, RecurringTaskTemplate, Task, TaskStatus, User, UserRole
from app.permissions import can_access_task
from app.routers.tasks import apply_status_effects, validate_status_reasons, validate_status_transition
from app.routers.users import sync_department_manager
from app.routers.bills_imports import parse_rows, title_date
from app.services.reports import delay_hours_for_task, is_effectively_over_expected, kpi_summary, scoped_tasks
from app.services.recurring_tasks import generated_title, is_template_due


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


class RestrictedDepartmentPermissionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

        self.general = Department(name_ar="General", is_restricted=False)
        self.finance = Department(name_ar="Finance", is_restricted=True)
        self.db.add_all([self.general, self.finance])
        self.db.flush()

        self.super_admin = User(username="admin", password_hash="x", full_name_ar="Super", role=UserRole.super_admin, department_id=self.general.id)
        self.admin = User(username="other-admin", password_hash="x", full_name_ar="Admin", role=UserRole.admin, department_id=self.general.id)
        self.finance_manager = User(username="finance-manager", password_hash="x", full_name_ar="Finance manager", role=UserRole.manager, department_id=self.finance.id)
        self.general_employee = User(username="general-user", password_hash="x", full_name_ar="General user", role=UserRole.employee, department_id=self.general.id)
        self.finance_employee = User(username="finance-user", password_hash="x", full_name_ar="Finance user", role=UserRole.employee, department_id=self.finance.id)
        self.bills_user = User(username="mariam", password_hash="x", full_name_ar="Mariam", role=UserRole.bills_user)
        self.db.add_all([self.super_admin, self.admin, self.finance_manager, self.general_employee, self.finance_employee, self.bills_user])
        self.db.flush()
        self.finance.manager_id = self.finance_manager.id

        self.general_task = self.make_task("General task", self.general.id, self.general_employee.id)
        self.finance_task = self.make_task("Finance task", self.finance.id, self.finance_employee.id)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def make_task(self, title, department_id, assignee_id):
        task = Task(
            title=title,
            department_id=department_id,
            assigned_to_user_id=assignee_id,
            created_by_user_id=self.super_admin.id,
            status=TaskStatus.pending,
            expected_minutes=30,
            due_date=date.today(),
        )
        self.db.add(task)
        return task

    def test_normal_admin_cannot_access_restricted_task(self):
        self.assertFalse(can_access_task(self.admin, self.finance_task))
        self.assertTrue(can_access_task(self.admin, self.general_task))

    def test_finance_manager_can_access_own_department_task(self):
        self.assertTrue(can_access_task(self.finance_manager, self.finance_task))
        self.assertFalse(can_access_task(self.finance_manager, self.general_task))

    def test_super_admin_can_access_all_tasks(self):
        self.assertTrue(can_access_task(self.super_admin, self.finance_task))
        self.assertTrue(can_access_task(self.super_admin, self.general_task))

    def test_bills_user_cannot_access_tasks(self):
        self.assertFalse(can_access_task(self.bills_user, self.finance_task))
        self.assertFalse(can_access_task(self.bills_user, self.general_task))

    def test_report_scope_matches_task_visibility(self):
        admin_ids = {task.id for task in scoped_tasks(self.db, self.admin).all()}
        manager_ids = {task.id for task in scoped_tasks(self.db, self.finance_manager).all()}
        super_admin_ids = {task.id for task in scoped_tasks(self.db, self.super_admin).all()}

        self.assertEqual(admin_ids, {self.general_task.id})
        self.assertEqual(manager_ids, {self.finance_task.id})
        self.assertEqual(super_admin_ids, {self.general_task.id, self.finance_task.id})

    def test_manager_role_automatically_links_and_moves_department_manager(self):
        self.finance.manager_id = None
        sync_department_manager(self.db, self.finance_manager)
        self.db.flush()
        self.assertEqual(self.finance.manager_id, self.finance_manager.id)

        self.finance_manager.department_id = self.general.id
        sync_department_manager(self.db, self.finance_manager)
        self.db.flush()
        self.db.refresh(self.finance)
        self.db.refresh(self.general)
        self.assertIsNone(self.finance.manager_id)
        self.assertEqual(self.general.manager_id, self.finance_manager.id)


class RecurringTaskScheduleTests(unittest.TestCase):
    def template(self, frequency, start_date, monthly_day=None):
        return RecurringTaskTemplate(
            title="Finance close",
            department_id=1,
            assigned_to_user_id=1,
            created_by_user_id=2,
            priority="normal",
            expected_minutes=30,
            frequency=frequency,
            start_date=start_date,
            monthly_day=monthly_day,
            generation_hour=8,
            is_active=True,
        )

    def test_daily_schedule_skips_friday(self):
        template = self.template("daily", date(2026, 10, 1))

        self.assertFalse(is_template_due(template, date(2026, 10, 2)))
        self.assertTrue(is_template_due(template, date(2026, 10, 3)))

    def test_monthly_schedule_uses_last_day_for_short_month(self):
        template = self.template("monthly", date(2026, 1, 31), monthly_day=31)

        self.assertTrue(is_template_due(template, date(2026, 2, 28)))
        self.assertFalse(is_template_due(template, date(2026, 2, 27)))

    def test_generated_title_contains_occurrence_date(self):
        self.assertEqual(generated_title("Finance close", date(2026, 10, 3)), "Finance close - 03-10-2026")


class BillsImportTests(unittest.TestCase):
    def test_parser_carries_forward_merged_style_cells_and_builds_titles(self):
        pasted = (
            "مسؤول الزبون\tرقم امر العمل\tاسم العميل\tاسم المادة\n"
            "ابو فيصل\t12643\tشركة انطاليا\tعلبة بقلاوة 1500 غ\n"
            "\t12695\t\tعلبة بقلاوة 1000 غ"
        )

        rows = parse_rows(pasted, date(2026, 9, 30))

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]["customer_rep"], "ابو فيصل")
        self.assertEqual(rows[1]["customer_name"], "شركة انطاليا")
        self.assertEqual(rows[1]["title"], "12695 - شركة انطاليا - علبة بقلاوة 1000 غ 9/30/2026")
        self.assertEqual(rows[1]["status"], "ready")

    def test_parser_marks_missing_work_order_as_invalid(self):
        rows = parse_rows("ابو عمر\t\tشركة العميل\tعلبة", date(2026, 9, 30))

        self.assertEqual(rows[0]["status"], "invalid")
        self.assertIn("رقم أمر العمل", rows[0]["message"])

    def test_title_date_uses_requested_format(self):
        self.assertEqual(title_date(date(2026, 9, 3)), "9/3/2026")


if __name__ == "__main__":
    unittest.main()
