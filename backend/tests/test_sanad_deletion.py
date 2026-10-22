import os
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Department, Notification, Task, TaskAttachment, TaskStatus, User, UserRole
from app.routers.bills_imports import delete_sanad
from app.services.storage import upload_object


class SanadDeletionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite:///:memory:')
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'STORAGE_BACKEND': 'local', 'LOCAL_STORAGE_ROOT': self.temp.name, 'LOCAL_STORAGE_BUCKET': 'attachments'})
        self.env.start()
        self.department = Department(name_ar='Finance')
        self.db.add(self.department)
        self.db.flush()
        self.mariam = self.make_user('mariam', UserRole.bills_user)
        self.other = self.make_user('other-importer', UserRole.bills_user)
        self.employee = self.make_user('employee', UserRole.employee)
        self.manager = self.make_user('manager', UserRole.manager)
        self.admin = self.make_user('superadmin', UserRole.super_admin)
        self.task = self.make_task('First bill', self.mariam)
        self.first = self.attach(self.task, 'first.jpg')
        self.second = self.attach(self.task, 'second.jpg')
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.env.stop()
        self.temp.cleanup()

    def make_user(self, username, role):
        user = User(username=username, full_name_ar=username, password_hash='test', role=role, department_id=self.department.id)
        self.db.add(user)
        self.db.flush()
        return user

    def make_task(self, title, author):
        task = Task(title=title, created_by_user_id=author.id, assigned_to_user_id=self.employee.id, department_id=self.department.id, status=TaskStatus.pending, expected_minutes=10, due_date=date.today(), billing_import_key=title)
        self.db.add(task)
        self.db.flush()
        return task

    def attach(self, task, name, kind='sanad'):
        stored = f'tasks/{task.id}/{name}'
        upload_object(stored, b'test attachment contents', 'image/jpeg')
        attachment = TaskAttachment(task_id=task.id, uploaded_by_user_id=self.mariam.id, original_filename=name, stored_filename=stored, content_type='image/jpeg', size_bytes=24, attachment_kind=kind)
        self.db.add(attachment)
        self.db.flush()
        return attachment

    def file(self, attachment):
        return Path(self.temp.name) / 'attachments' / attachment.stored_filename

    def test_mariam_deletes_one_sanad_without_deleting_task_or_other_files(self):
        first_file = self.file(self.first)
        second_id = self.second.id
        result = delete_sanad(self.task.id, self.first.id, self.db, self.mariam)
        self.assertEqual([item.id for item in result.sanads], [second_id])
        self.assertTrue(result.has_sanad)
        self.assertIsNone(self.task.deleted_at)
        self.assertEqual(self.db.query(Task).count(), 1)
        self.assertFalse(first_file.exists())
        self.assertTrue(self.file(self.second).exists())
        notification = self.db.query(Notification).filter_by(user_id=self.manager.id).one()
        self.assertEqual(notification.notification_type, 'sanad_deleted')
        self.assertIn('first.jpg', notification.message)

    def test_deleting_last_sanad_updates_history_metadata(self):
        delete_sanad(self.task.id, self.first.id, self.db, self.mariam)
        result = delete_sanad(self.task.id, self.second.id, self.db, self.mariam)
        self.assertFalse(result.has_sanad)
        self.assertIsNone(result.sanad_filename)
        self.assertEqual(result.sanads, [])

    def test_cannot_delete_other_importers_sanad(self):
        self.task.created_by_user_id = self.other.id
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            delete_sanad(self.task.id, self.first.id, self.db, self.mariam)
        self.assertEqual(error.exception.status_code, 403)
        self.assertTrue(self.file(self.first).exists())

    def test_attachment_id_must_belong_to_selected_bill(self):
        other_task = self.make_task('Other bill', self.mariam)
        other_file = self.attach(other_task, 'other.jpg')
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            delete_sanad(self.task.id, other_file.id, self.db, self.mariam)
        self.assertEqual(error.exception.status_code, 404)
        self.assertTrue(self.file(other_file).exists())

    def test_general_attachments_cannot_be_deleted_through_sanad_endpoint(self):
        general = self.attach(self.task, 'general.jpg', 'general')
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            delete_sanad(self.task.id, general.id, self.db, self.mariam)
        self.assertEqual(error.exception.status_code, 404)
        self.assertTrue(self.file(general).exists())

    def test_employees_cannot_delete_imported_sanads(self):
        with self.assertRaises(HTTPException) as error:
            delete_sanad(self.task.id, self.first.id, self.db, self.employee)
        self.assertEqual(error.exception.status_code, 403)

    def test_superadmin_can_delete_sanad(self):
        result = delete_sanad(self.task.id, self.first.id, self.db, self.admin)
        self.assertEqual(len(result.sanads), 1)

    def test_deleted_bill_cannot_be_modified(self):
        self.task.deleted_at = datetime.now(timezone.utc)
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            delete_sanad(self.task.id, self.first.id, self.db, self.mariam)
        self.assertEqual(error.exception.status_code, 404)
        self.assertTrue(self.file(self.first).exists())

    def test_failed_database_commit_does_not_remove_file(self):
        first_id = self.first.id
        first_file = self.file(self.first)
        with patch.object(self.db, 'commit', side_effect=RuntimeError('test failure')):
            with self.assertRaises(RuntimeError):
                delete_sanad(self.task.id, first_id, self.db, self.mariam)
        self.db.rollback()
        self.assertTrue(first_file.exists())
        self.assertIsNotNone(self.db.get(TaskAttachment, first_id))
