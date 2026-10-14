import unittest
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Department, DirectMessage, Notification, RecurringTaskTemplate, Task, TaskAttachment, TaskStatus, User, UserRole
from app.permissions import can_access_task
from app.routers.tasks import apply_status_effects, attachment_for_task_or_split_group, hydrate_shared_sanads, split_task, validate_status_reasons, validate_status_transition
from app.schemas import BillsImportHistoryUpdate, BillsImportRequest, BillsMessageCreate, DirectMessageCreate, TaskDelete, TaskSplitCreate
from app.routers.users import sync_department_manager
from app.routers.bills_imports import delete_bills_import_history, finance_import_assignee, group_rows_by_customer, history_row, inspect_import, parse_rows, row_key, sanad_notification_recipient_ids, title_date, update_bills_import_history
from app.routers.notifications import list_bills_todos, mark_all_notifications_read, send_bills_message
from app.routers.messages import get_conversation, list_chat_contacts, mark_conversation_read, send_direct_message
from app.services.reports import delay_hours_for_task, is_effectively_over_expected, kpi_summary, scoped_tasks
from app.services.recurring_tasks import generated_title, is_template_due
from app.services.auto_pause import pause_missed_end_of_day_tasks


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
        self.finance = Department(name_ar="Finance", name_en="Finance", is_restricted=True)
        self.db.add_all([self.general, self.finance])
        self.db.flush()

        self.super_admin = User(username="admin", password_hash="x", full_name_ar="Super", role=UserRole.super_admin, department_id=self.general.id)
        self.admin = User(username="other-admin", password_hash="x", full_name_ar="Admin", role=UserRole.admin, department_id=self.general.id)
        self.finance_manager = User(username="finance-manager", password_hash="x", full_name_ar="Finance manager", role=UserRole.manager, department_id=self.finance.id)
        self.general_employee = User(username="general-user", password_hash="x", full_name_ar="General user", role=UserRole.employee, department_id=self.general.id)
        self.finance_employee = User(username="finance-user", password_hash="x", full_name_ar="Finance user", role=UserRole.employee, department_id=self.finance.id)
        self.aseel = User(username="aseel", password_hash="x", full_name_ar="Aseel", role=UserRole.employee, department_id=self.finance.id)
        self.bills_user = User(username="mariam", password_hash="x", full_name_ar="Mariam", role=UserRole.bills_user)
        self.db.add_all([self.super_admin, self.admin, self.finance_manager, self.general_employee, self.finance_employee, self.aseel, self.bills_user])
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

    def test_normal_admin_chat_hides_restricted_department_employees(self):
        contacts = list_chat_contacts(self.db, self.admin)

        self.assertIn(self.general_employee.id, [item.id for item in contacts])
        self.assertNotIn(self.finance_employee.id, [item.id for item in contacts])

    def test_normal_admin_cannot_send_to_restricted_employee(self):
        with self.assertRaises(HTTPException) as error:
            send_direct_message(DirectMessageCreate(recipient_id=self.finance_employee.id, body="Private"), self.db, self.admin)
        self.assertEqual(error.exception.status_code, 403)

    def test_employee_cannot_message_another_employee(self):
        with self.assertRaises(HTTPException) as error:
            send_direct_message(DirectMessageCreate(recipient_id=self.finance_employee.id, body="Private"), self.db, self.general_employee)
        self.assertEqual(error.exception.status_code, 403)

    def test_manager_and_bills_user_cannot_access_chat(self):
        for user in [self.finance_manager, self.bills_user]:
            with self.assertRaises(HTTPException) as error:
                list_chat_contacts(self.db, user)
            self.assertEqual(error.exception.status_code, 403)

    def test_chat_rejects_blank_messages_and_preserves_line_breaks(self):
        with self.assertRaises(HTTPException) as error:
            send_direct_message(DirectMessageCreate(recipient_id=self.general_employee.id, body=" \n "), self.db, self.admin)
        self.assertEqual(error.exception.status_code, 400)
        sent = send_direct_message(DirectMessageCreate(recipient_id=self.general_employee.id, body="First\nSecond"), self.db, self.admin)
        self.assertEqual(sent.body, "First\nSecond")

    def test_conversation_does_not_include_another_admin_messages(self):
        own = send_direct_message(DirectMessageCreate(recipient_id=self.general_employee.id, body="Own"), self.db, self.admin)
        send_direct_message(DirectMessageCreate(recipient_id=self.general_employee.id, body="Other"), self.db, self.super_admin)
        messages = get_conversation(self.general_employee.id, limit=100, db=self.db, current_user=self.admin)
        self.assertEqual([message.id for message in messages], [own.id])

    def test_chat_rejects_inactive_recipients(self):
        self.general_employee.is_active = False
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            send_direct_message(DirectMessageCreate(recipient_id=self.general_employee.id, body="Hello"), self.db, self.admin)
        self.assertEqual(error.exception.status_code, 400)

    def test_super_admin_can_message_restricted_department_employee(self):
        message = send_direct_message(
            DirectMessageCreate(recipient_id=self.finance_employee.id, body="Please review today's work."),
            self.db,
            self.super_admin,
        )

        self.assertEqual(message.sender_id, self.super_admin.id)
        notification = self.db.query(Notification).filter(Notification.user_id == self.finance_employee.id).one()
        self.assertEqual(notification.notification_type, "direct_message")
        self.assertEqual(notification.related_user_id, self.super_admin.id)

    def test_employee_can_reply_only_after_admin_starts_conversation(self):
        with self.assertRaises(HTTPException):
            send_direct_message(
                DirectMessageCreate(recipient_id=self.admin.id, body="Can I start this chat?"),
                self.db,
                self.general_employee,
            )

        send_direct_message(
            DirectMessageCreate(recipient_id=self.general_employee.id, body="Please send an update."),
            self.db,
            self.admin,
        )
        reply = send_direct_message(
            DirectMessageCreate(recipient_id=self.admin.id, body="The update is ready."),
            self.db,
            self.general_employee,
        )

        self.assertEqual(reply.recipient_id, self.admin.id)

    def test_reading_chat_marks_messages_and_notifications_read(self):
        send_direct_message(
            DirectMessageCreate(recipient_id=self.general_employee.id, body="Please check this."),
            self.db,
            self.admin,
        )

        marked = mark_conversation_read(self.admin.id, self.db, self.general_employee)

        self.assertEqual(len(marked), 1)
        self.assertIsNotNone(self.db.query(DirectMessage).one().read_at)
        self.assertIsNotNone(self.db.query(Notification).one().read_at)

    def test_finance_team_can_message_active_bills_users(self):
        result = send_bills_message(
            BillsMessageCreate(message="  الفواتير جاهزة  "),
            self.db,
            self.finance_employee,
        )

        notification = self.db.query(Notification).filter(Notification.user_id == self.bills_user.id).one()
        self.assertEqual(result.sent_count, 1)
        self.assertEqual(notification.notification_type, "finance_message")
        self.assertEqual(notification.message, "Finance user: الفواتير جاهزة")

    def test_finance_messages_stay_in_bills_todos_until_completed(self):
        send_bills_message(BillsMessageCreate(message="Prepare the bills"), self.db, self.finance_employee)

        todos = list_bills_todos(self.db, self.bills_user)
        self.assertEqual(len(todos), 1)

        mark_all_notifications_read(self.db, self.bills_user)
        self.assertEqual(len(list_bills_todos(self.db, self.bills_user)), 1)

        todos[0].read_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertEqual(list_bills_todos(self.db, self.bills_user), [])

    def test_non_finance_user_cannot_message_bills_users(self):
        with self.assertRaises(HTTPException) as raised:
            send_bills_message(
                BillsMessageCreate(message="Not allowed"),
                self.db,
                self.general_employee,
            )

        self.assertEqual(raised.exception.status_code, 403)

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

    def test_finance_import_defaults_to_manager_and_can_be_configured(self):
        assignee, _ = finance_import_assignee(self.db, self.finance)
        self.assertEqual(assignee.id, self.finance_manager.id)

        self.finance.billing_assignee_id = self.finance_employee.id
        self.db.commit()
        assignee, _ = finance_import_assignee(self.db, self.finance)
        self.assertEqual(assignee.id, self.finance_employee.id)

    def test_assignee_can_split_finance_task_to_another_finance_user(self):
        self.finance_task.status = TaskStatus.in_progress
        self.finance_task.work_seconds = 180
        self.db.commit()

        parts = split_task(
            self.finance_task.id,
            TaskSplitCreate(
                current_label="Review",
                other_label="Add bill",
                shared_expected_minutes=30,
                other_assignee_id=self.aseel.id,
            ),
            self.db,
            self.finance_employee,
        )

        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0].status, TaskStatus.in_progress)
        self.assertEqual(parts[0].work_seconds, 180)
        self.assertEqual(parts[0].split_part, 1)
        self.assertEqual(parts[1].status, TaskStatus.pending)
        self.assertEqual(parts[1].assigned_to_user_id, self.aseel.id)
        self.assertEqual(parts[1].split_part, 2)
        self.assertEqual(parts[0].split_group_id, parts[1].split_group_id)
        self.assertEqual(parts[0].expected_minutes, 30)
        self.assertEqual(parts[1].expected_minutes, 30)
        self.assertEqual(parts[0].split_expected_minutes, 30)
        self.assertEqual(parts[1].split_expected_minutes, 30)
        self.assertIsNotNone(parts[0].timer_started_at)
        self.assertEqual(parts[0].timer_started_at, parts[1].timer_started_at)

        parts[1].status = TaskStatus.in_progress
        apply_status_effects(parts[1], TaskStatus.pending, TaskStatus.in_progress, self.aseel, self.db)
        parts[0].status = TaskStatus.blocked
        apply_status_effects(parts[0], TaskStatus.in_progress, TaskStatus.blocked, self.finance_employee, self.db)
        self.assertIsNotNone(parts[0].timer_started_at)
        self.assertEqual(parts[0].timer_started_at, parts[1].timer_started_at)

        parts[1].status = TaskStatus.blocked
        apply_status_effects(parts[1], TaskStatus.in_progress, TaskStatus.blocked, self.aseel, self.db)
        self.assertIsNone(parts[0].timer_started_at)
        self.assertIsNone(parts[1].timer_started_at)
        self.assertEqual(parts[0].work_seconds, parts[1].work_seconds)

    def test_split_task_can_use_sanad_attached_to_its_sibling(self):
        self.finance_task.split_group_id = "shared-sanad-group"
        self.finance_task.split_part = 1
        self.finance_task.split_total = 2
        other_task = self.make_task("Finance task 1.2", self.finance.id, self.aseel.id)
        other_task.split_group_id = "shared-sanad-group"
        other_task.split_part = 2
        other_task.split_total = 2
        self.db.flush()
        attachment = TaskAttachment(
            task_id=self.finance_task.id,
            uploaded_by_user_id=self.bills_user.id,
            original_filename="sanad.jpg",
            stored_filename="tasks/shared-sanad.jpg",
            content_type="image/jpeg",
            size_bytes=100,
            attachment_kind="sanad",
        )
        self.db.add(attachment)
        self.db.commit()

        hydrate_shared_sanads(self.db, [other_task])

        self.assertTrue(other_task.has_sanad)
        self.assertEqual(other_task.shared_sanad_attachment.id, attachment.id)
        self.assertEqual(attachment_for_task_or_split_group(self.db, other_task, attachment.id).id, attachment.id)

    def test_sanad_notification_goes_to_active_finance_team_members(self):
        recipients = sanad_notification_recipient_ids(self.db, self.finance_task, self.bills_user.id)

        self.assertIn(self.finance_manager.id, recipients)
        self.assertIn(self.finance_employee.id, recipients)
        self.assertIn(self.aseel.id, recipients)
        self.assertNotIn(self.general_employee.id, recipients)
        self.assertNotIn(self.bills_user.id, recipients)

    def test_bills_user_can_edit_own_uploaded_names_and_date_without_reassignment(self):
        original_date = date(2026, 10, 1)
        task = Task(
            title="100 - Old customer - Old material 10/1/2026",
            department_id=self.finance.id,
            assigned_to_user_id=self.aseel.id,
            created_by_user_id=self.bills_user.id,
            status=TaskStatus.pending,
            expected_minutes=10,
            due_date=original_date,
            billing_import_key=row_key(original_date, "100", "Old customer", "Old material"),
            billing_work_order_id="100",
            billing_customer_name="Old customer",
            billing_material_name="Old material",
        )
        self.db.add(task)
        self.db.commit()

        result = update_bills_import_history(
            task.id,
            BillsImportHistoryUpdate(
                task_date=date(2026, 10, 2),
                customer_rep="New rep",
                customer_name="New customer",
                material_name="New material",
                note="Call the customer before processing",
            ),
            self.db,
            self.bills_user,
        )

        self.assertEqual(result.task_date, date(2026, 10, 2))
        self.assertEqual(result.customer_name, "New customer")
        self.assertEqual(result.material_name, "New material")
        self.assertEqual(result.note, "Call the customer before processing")
        self.assertEqual(task.billing_note, "Call the customer before processing")
        self.assertIn("Call the customer before processing", task.description)
        self.assertEqual(task.assigned_to_user_id, self.aseel.id)
        self.assertEqual(task.title, "100 - New customer - New material 10/2/2026")

    def test_bills_user_delete_requires_reason_and_notifies_finance_manager(self):
        task = Task(
            title="Imported bill to delete",
            department_id=self.finance.id,
            assigned_to_user_id=self.aseel.id,
            created_by_user_id=self.bills_user.id,
            status=TaskStatus.pending,
            expected_minutes=10,
            due_date=date(2026, 10, 4),
            billing_import_key=row_key(date(2026, 10, 4), "100", "Customer", "Material"),
            billing_work_order_id="100",
            billing_customer_name="Customer",
            billing_material_name="Material",
        )
        self.db.add(task)
        self.db.commit()

        delete_bills_import_history(task.id, TaskDelete(reason="Entered by mistake"), self.db, self.bills_user)

        self.assertIsNotNone(task.deleted_at)
        self.assertEqual(task.deletion_reason, "Entered by mistake")
        notification = self.db.query(Notification).filter(Notification.user_id == self.finance_manager.id).one()
        self.assertEqual(notification.notification_type, "bill_task_deleted")
        self.assertIn("Entered by mistake", notification.message)

    def test_same_customer_can_have_a_different_bill_on_the_same_day(self):
        task_date = date(2026, 10, 6)
        existing = Task(
            title="TEST-003 - Example Customer - Example Material 10/6/2026",
            department_id=self.finance.id,
            assigned_to_user_id=self.aseel.id,
            created_by_user_id=self.bills_user.id,
            status=TaskStatus.pending,
            expected_minutes=10,
            due_date=task_date,
            billing_import_key=row_key(task_date, "TEST-003", "Example Customer", "Example Material"),
            billing_work_order_id="TEST-003",
            billing_customer_name="Example Customer",
            billing_material_name="Example Material",
        )
        self.db.add(existing)
        self.db.commit()

        _, _, different_bill = inspect_import(
            self.db,
            BillsImportRequest(pasted_text="Example Rep\tTEST-004\tExample Customer\tAnother Material", task_date=task_date),
        )
        _, _, exact_repeat = inspect_import(
            self.db,
            BillsImportRequest(pasted_text="Example Rep\tTEST-003\tExample Customer\tExample Material", task_date=task_date),
        )

        self.assertEqual(different_bill[0]["status"], "ready")
        self.assertEqual(exact_repeat[0]["status"], "duplicate")

    def test_server_catches_missed_end_of_day_without_counting_the_night(self):
        amman = ZoneInfo("Asia/Amman")
        started_at = datetime(2026, 10, 10, 16, 0, tzinfo=amman).astimezone(timezone.utc)
        task = Task(
            title="Still running overnight",
            department_id=self.finance.id,
            assigned_to_user_id=self.finance_employee.id,
            created_by_user_id=self.finance_manager.id,
            status=TaskStatus.in_progress,
            expected_minutes=30,
            due_date=date(2026, 10, 10),
            started_at=started_at,
            timer_started_at=started_at,
            work_seconds=120,
        )
        today_task = Task(
            title="Started this morning",
            department_id=self.finance.id,
            assigned_to_user_id=self.aseel.id,
            created_by_user_id=self.finance_manager.id,
            status=TaskStatus.in_progress,
            expected_minutes=30,
            due_date=date(2026, 10, 11),
            started_at=datetime(2026, 10, 11, 8, 0, tzinfo=amman).astimezone(timezone.utc),
            timer_started_at=datetime(2026, 10, 11, 8, 0, tzinfo=amman).astimezone(timezone.utc),
            work_seconds=0,
        )
        self.db.add_all([task, today_task])
        self.db.commit()

        paused = pause_missed_end_of_day_tasks(
            self.db,
            datetime(2026, 10, 11, 9, 0, tzinfo=amman),
        )
        self.db.commit()

        self.assertEqual([item.id for item in paused], [task.id])
        self.assertEqual(task.status, TaskStatus.blocked)
        self.assertEqual(task.hold_reason_text, "END OF DAY")
        self.assertIsNone(task.timer_started_at)
        self.assertEqual(task.work_seconds, 120 + 60 * 60)
        self.assertEqual(today_task.status, TaskStatus.in_progress)
        notification = self.db.query(Notification).filter(Notification.user_id == self.finance_employee.id).one()
        self.assertEqual(notification.notification_type, "auto_paused")


class SplitTaskReportTests(unittest.TestCase):
    def test_two_split_halves_count_as_one_task(self):
        tasks = [
            Task(
                title=f"Split 1.{part}",
                department_id=1,
                assigned_to_user_id=part,
                created_by_user_id=1,
                status=TaskStatus.done,
                expected_minutes=30,
                due_date=date.today(),
                work_seconds=10 * 60,
                split_group_id="group-1",
                split_part=part,
                split_total=2,
                split_expected_minutes=30,
                self_created_approved=True,
            )
            for part in (1, 2)
        ]

        summary = kpi_summary(tasks)

        self.assertEqual(summary["evaluated_tasks"], 1)
        self.assertEqual(summary["completed_tasks"], 1)
        self.assertEqual(summary["total_estimated_hours"], 0.5)


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
    def test_task_reports_when_a_sanad_is_attached(self):
        task = Task(
            title="Imported bill",
            department_id=1,
            assigned_to_user_id=1,
            created_by_user_id=2,
            expected_minutes=10,
            due_date=date.today(),
        )
        task.attachments = [
            TaskAttachment(
                task_id=1,
                uploaded_by_user_id=2,
                original_filename="sanad.jpg",
                stored_filename="tasks/1/sanad.jpg",
                content_type="image/jpeg",
                size_bytes=100,
                attachment_kind="sanad",
            )
        ]

        self.assertTrue(task.has_sanad)

    def test_history_row_returns_every_attached_sanad(self):
        task = Task(
            id=1,
            title="Grouped imported bill",
            department_id=1,
            assigned_to_user_id=1,
            created_by_user_id=2,
            status=TaskStatus.pending,
            expected_minutes=10,
            due_date=date.today(),
            created_at=datetime.now(timezone.utc),
            billing_work_order_id="100, 101",
            billing_customer_name="Customer",
            billing_material_name="Material A | Material B",
        )
        task.attachments = [
            TaskAttachment(id=index, task_id=1, uploaded_by_user_id=2, original_filename=f"sanad-{index}.jpg", stored_filename=f"tasks/1/sanad-{index}.jpg", content_type="image/jpeg", size_bytes=100, attachment_kind="sanad", created_at=datetime.now(timezone.utc))
            for index in (1, 2)
        ]

        result = history_row(task)

        self.assertTrue(result.has_sanad)
        self.assertEqual(len(result.sanads), 2)

    def test_parser_carries_forward_merged_style_cells_and_builds_titles(self):
        pasted = (
            "مسؤول الزبون\tرقم امر العمل\tاسم العميل\tاسم المادة\n"
            "مندوب تجريبي\tTEST-001\tشركة تجريبية\tمادة تجريبية أولى\n"
            "\tTEST-002\t\tمادة تجريبية ثانية"
        )

        rows = parse_rows(pasted, date(2026, 9, 30))

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]["customer_rep"], "مندوب تجريبي")
        self.assertEqual(rows[1]["customer_name"], "شركة تجريبية")
        self.assertEqual(rows[1]["title"], "TEST-002 - شركة تجريبية - مادة تجريبية ثانية 9/30/2026")
        self.assertEqual(rows[1]["status"], "ready")

    def test_parser_marks_missing_work_order_as_invalid(self):
        rows = parse_rows("مندوب تجريبي\t\tشركة تجريبية\tمادة تجريبية", date(2026, 9, 30))

        self.assertEqual(rows[0]["status"], "invalid")
        self.assertIn("رقم أمر العمل", rows[0]["message"])

    def test_parser_accepts_zero_as_the_plain_bag_work_order_id(self):
        rows = parse_rows("Abu Omar\t٠\tPlain Bag Customer\tPlain bags", date(2026, 10, 4))

        self.assertEqual(rows[0]["status"], "ready")
        self.assertEqual(rows[0]["work_order_id"], "0")
        self.assertTrue(rows[0]["title"].startswith("0 - "))

    def test_parser_accepts_an_optional_note_column(self):
        rows = parse_rows(
            "مندوب تجريبي\tTEST-001\tشركة تجريبية\tمادة تجريبية\tملاحظة تجريبية",
            date(2026, 9, 30),
        )

        self.assertEqual(rows[0]["note"], "ملاحظة تجريبية")
        self.assertEqual(rows[0]["material_name"], "مادة تجريبية")

    def test_rows_for_the_same_customer_are_grouped_into_one_bill_task(self):
        task_date = date(2026, 10, 4)
        rows = parse_rows(
            "مندوب تجريبي\tTEST-001\tشركة تجريبية\tمادة أولى\tملاحظة أولى\n"
            "مندوب تجريبي\tTEST-002\tشركة تجريبية\tمادة ثانية\tملاحظة ثانية",
            task_date,
        )

        grouped = group_rows_by_customer(rows, task_date)

        self.assertEqual(len(grouped), 1)
        self.assertEqual(grouped[0]["row_count"], 2)
        self.assertEqual(grouped[0]["work_order_id"], "TEST-001، TEST-002")
        self.assertIn("فاتورة مجمعة", grouped[0]["title"])
        self.assertIn("أمر العمل TEST-001: مادة أولى", grouped[0]["description"])
        self.assertIn("أمر العمل TEST-002: مادة ثانية", grouped[0]["description"])

    def test_title_date_uses_requested_format(self):
        self.assertEqual(title_date(date(2026, 9, 3)), "9/3/2026")


if __name__ == "__main__":
    unittest.main()
