import csv
import re
from datetime import date, datetime, timezone
from hashlib import sha256
from html import unescape
from io import StringIO
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import Department, Notification, Task, TaskAttachment, TaskPriority, TaskStatus, TaskStatusHistory, User, UserRole
from ..schemas import BillsImportAssignee, BillsImportConfigOut, BillsImportConfigUpdate, BillsImportHistoryRow, BillsImportHistoryUpdate, BillsImportRequest, BillsImportResult, BillsImportRow, TaskDelete
from ..services.storage import delete_objects, download_object, upload_object

router = APIRouter(prefix="/bills-import", tags=["bills import"])
MAX_SANAD_BYTES = 10 * 1024 * 1024
MAX_SANADS_PER_TASK = 20
SANAD_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


def require_bills_importer(user: User):
    if user.role not in {UserRole.bills_user, UserRole.super_admin}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bills import access only")


def bills_task_or_403(db: Session, task_id: int, current_user: User):
    task = db.query(Task).filter(Task.id == task_id, Task.billing_import_key.is_not(None), Task.deleted_at.is_(None)).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imported bill task not found")
    if current_user.role == UserRole.bills_user and task.created_by_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This task was uploaded by another user")
    return task


def read_sanad_image(upload: UploadFile, task_id: int):
    content_type = (upload.content_type or "").lower()
    if content_type not in SANAD_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The sanad must be a JPG, PNG, or WEBP image")
    original_filename = Path(upload.filename or "sanad").name.strip()
    original_filename = re.sub(r"[^A-Za-z0-9._ -]", "_", original_filename)[:255] or "sanad"
    content = upload.file.read(MAX_SANAD_BYTES + 1)
    if len(content) > MAX_SANAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The sanad image must be 10 MB or smaller")
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The sanad image is empty")
    stored_filename = f"tasks/{task_id}/{uuid4().hex}_sanad_{original_filename}"
    return original_filename, stored_filename, len(content), content, content_type


def finance_department(db: Session):
    department = (
        db.query(Department)
        .filter(
            (func.lower(func.coalesce(Department.name_en, "")) == "finance")
            | (Department.name_ar == "المالية")
        )
        .first()
    )
    if not department:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Finance department was not found")
    return department


def finance_team_users(db: Session, department: Department):
    return (
        db.query(User)
        .filter(
            User.department_id == department.id,
            User.is_active.is_(True),
            User.role != UserRole.bills_user,
        )
        .order_by(User.full_name_ar)
        .all()
    )


def finance_import_assignee(db: Session, department: Department):
    users = finance_team_users(db, department)
    assignee = next((user for user in users if user.id == department.billing_assignee_id), None)
    if not assignee:
        assignee = next((user for user in users if user.id == department.manager_id), None)
    if not assignee:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Finance department needs an active bills assignee")
    if department.billing_assignee_id != assignee.id:
        department.billing_assignee_id = assignee.id
        db.commit()
    return assignee, users


def require_finance_manager(user: User, department: Department):
    if user.role == UserRole.super_admin:
        return
    if user.role != UserRole.manager or user.id != department.manager_id or user.department_id != department.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Finance manager or super admin only")


def clean_cell(value: str) -> str:
    return " ".join(unescape(value or "").replace("\u00a0", " ").split()).strip()


def clean_note(value: str) -> str:
    decoded = unescape(value or "").replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.strip() for line in decoded.split("\n") if line.strip())


def title_date(value: date) -> str:
    return f"{value.month}/{value.day}/{value.year}"


def row_key(task_date: date, work_order_id: str, customer_name: str, material_name: str) -> str:
    source = "|".join((task_date.isoformat(), work_order_id.casefold(), customer_name.casefold(), material_name.casefold()))
    return sha256(source.encode("utf-8")).hexdigest()


def customer_group_key(task_date: date, customer_name: str) -> str:
    source = "|".join(("customer-bill", task_date.isoformat(), clean_cell(customer_name).casefold()))
    return sha256(source.encode("utf-8")).hexdigest()


def unique_values(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        cleaned = clean_cell(value)
        key = cleaned.casefold()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def compact_values(values: list[str], separator: str, max_length: int) -> str:
    combined = separator.join(values)
    if len(combined) <= max_length:
        return combined
    suffix = f" +{max(len(values) - 2, 1)}"
    prefix = separator.join(values[:2])
    return f"{prefix[:max_length - len(suffix)]}{suffix}"


def grouped_bill_title(task_date: date, customer_name: str, work_order_ids: list[str], material_names: list[str]) -> str:
    if len(material_names) == 1 and len(work_order_ids) == 1:
        return f"{work_order_ids[0]} - {customer_name} - {material_names[0]} {title_date(task_date)}"
    ids_label = "، ".join(work_order_ids[:3])
    if len(work_order_ids) > 3:
        ids_label = f"{ids_label} +{len(work_order_ids) - 3}"
    title = f"{ids_label} - {customer_name} - فاتورة مجمعة ({len(material_names)} مواد) {title_date(task_date)}"
    if len(title) <= 220:
        return title
    fallback = f"{customer_name} - فاتورة مجمعة ({len(work_order_ids)} أوامر عمل) {title_date(task_date)}"
    return fallback[:220]


def grouped_bill_description(customer_rows: list[dict]) -> str:
    first = customer_rows[0]
    lines = [f"اسم العميل: {first['customer_name']}", "تفاصيل الفاتورة:"]
    for row in customer_rows:
        detail = f"- أمر العمل {row['work_order_id']}: {row['material_name']}"
        if row["customer_rep"]:
            detail += f" | مسؤول الزبون: {row['customer_rep']}"
        if row["note"]:
            detail += f" | ملاحظات: {row['note']}"
        lines.append(detail)
    return "\n".join(lines)


def group_rows_by_customer(rows: list[dict], task_date: date) -> list[dict]:
    grouped = []
    by_customer = {}
    for row in rows:
        if row["status"] == "invalid":
            grouped.append(row)
            continue
        customer_key = clean_cell(row["customer_name"]).casefold()
        if customer_key not in by_customer:
            by_customer[customer_key] = []
        by_customer[customer_key].append(row)

    for customer_rows in by_customer.values():
        first = customer_rows[0]
        work_order_ids = unique_values([row["work_order_id"] for row in customer_rows])
        material_names = unique_values([row["material_name"] for row in customer_rows])
        customer_reps = unique_values([row["customer_rep"] for row in customer_rows])
        notes = unique_values([row["note"] for row in customer_rows])
        grouped.append(
            {
                **first,
                "row_count": len(customer_rows),
                "customer_rep": compact_values(customer_reps, "، ", 160),
                "work_order_id": compact_values(work_order_ids, "، ", 80),
                "material_name": compact_values(material_names, " | ", 320),
                "note": "\n".join(notes),
                "title": grouped_bill_title(task_date, first["customer_name"], work_order_ids, material_names),
                "description": grouped_bill_description(customer_rows),
                "key": customer_group_key(task_date, first["customer_name"]),
                "message": f"تم دمج {len(customer_rows)} صفوف للعميل نفسه" if len(customer_rows) > 1 else None,
            }
        )
    return sorted(grouped, key=lambda row: row["row_number"])


def billing_description(customer_rep: str, work_order_id: str, customer_name: str, material_name: str, note: str = "") -> str:
    lines = [
        f"مسؤول الزبون: {customer_rep or '-'}",
        f"رقم أمر العمل: {work_order_id}",
        f"اسم العميل: {customer_name}",
        f"اسم المادة: {material_name}",
    ]
    if note:
        lines.append(f"ملاحظات: {note}")
    return "\n".join(lines)


def is_header_row(cells: list[str]) -> bool:
    combined = " ".join(cells)
    return "رقم" in combined and "امر العمل" in combined.replace("أ", "ا") and "اسم المادة" in combined


def parse_rows(pasted_text: str, task_date: date) -> list[dict]:
    decoded = unescape(pasted_text).replace("\r\n", "\n").replace("\r", "\n")
    rows = []
    previous_rep = ""
    previous_customer = ""
    for source_row, source_cells in enumerate(csv.reader(StringIO(decoded), delimiter="\t"), start=1):
        if not any(cell.strip() for cell in source_cells):
            continue
        cells = [clean_cell(cell) for cell in source_cells]
        if is_header_row(cells):
            continue
        if len(cells) < 5:
            cells.extend([""] * (5 - len(cells)))
        customer_rep, work_order_id, customer_name = cells[:3]
        material_name = cells[3]
        note = clean_note(" ".join(cells[4:]))
        customer_rep = customer_rep or previous_rep
        customer_name = customer_name or previous_customer
        if customer_rep:
            previous_rep = customer_rep
        if customer_name:
            previous_customer = customer_name
        title = f"{work_order_id} - {customer_name} - {material_name} {title_date(task_date)}" if work_order_id and customer_name and material_name else ""
        missing = []
        if not work_order_id:
            missing.append("رقم أمر العمل")
        if not customer_name:
            missing.append("اسم العميل")
        if not material_name:
            missing.append("اسم المادة")
        message = f"بيانات ناقصة: {', '.join(missing)}" if missing else None
        if title and len(title) > 220:
            message = "عنوان المهمة أطول من 220 حرفاً"
        if len(note) > 2000:
            message = "الملاحظات أطول من 2000 حرف"
        rows.append(
            {
                "row_number": source_row,
                "customer_rep": customer_rep,
                "work_order_id": work_order_id,
                "customer_name": customer_name,
                "material_name": material_name,
                "note": note,
                "title": title,
                "key": row_key(task_date, work_order_id, customer_name, material_name) if not message else None,
                "status": "invalid" if message else "ready",
                "message": message,
            }
        )
    return rows


def inspect_import(db: Session, payload: BillsImportRequest):
    department = finance_department(db)
    assignee, _ = finance_import_assignee(db, department)
    rows = group_rows_by_customer(parse_rows(payload.pasted_text, payload.task_date), payload.task_date)
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No task rows were found in the pasted text")
    existing_customers = {
        clean_cell(customer_name).casefold()
        for (customer_name,) in db.query(Task.billing_customer_name)
        .filter(
            Task.due_date == payload.task_date,
            Task.billing_customer_name.is_not(None),
            Task.deleted_at.is_(None),
        )
        .all()
    }
    for row in rows:
        if not row["key"] or row["status"] == "invalid":
            continue
        if clean_cell(row["customer_name"]).casefold() in existing_customers:
            row["status"] = "duplicate"
            row["message"] = "تمت إضافة فاتورة لهذا العميل في التاريخ نفسه مسبقاً"
    return department, assignee, rows


def result_for(department: Department, assignee: User, rows: list[dict], created_count: int = 0):
    return BillsImportResult(
        department_name=department.name_ar,
        assignee_name=assignee.full_name_ar,
        rows=[
            BillsImportRow(**{
                key: value
                for key, value in row.items()
                if key not in {"key", "description"}
            })
            for row in rows
        ],
        ready_count=sum(row["status"] == "ready" for row in rows),
        duplicate_count=sum(row["status"] == "duplicate" for row in rows),
        invalid_count=sum(row["status"] == "invalid" for row in rows),
        created_count=created_count,
    )


def history_row(task: Task):
    sanads = sorted(
        (attachment for attachment in task.attachments if attachment.attachment_kind == "sanad"),
        key=lambda attachment: (attachment.created_at.timestamp() if attachment.created_at else 0, attachment.id or 0),
        reverse=True,
    )
    return BillsImportHistoryRow(
        id=task.id,
        title=task.title,
        task_date=task.due_date,
        work_order_id=task.billing_work_order_id or "",
        customer_rep=task.billing_customer_rep,
        customer_name=task.billing_customer_name or "",
        material_name=task.billing_material_name or "",
        note=task.billing_note,
        status=task.status,
        created_at=task.created_at,
        has_sanad=bool(sanads),
        sanad_filename=sanads[0].original_filename if sanads else None,
        sanads=sanads,
    )


@router.get("/config", response_model=BillsImportConfigOut)
def get_bills_import_config(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    department = finance_department(db)
    require_finance_manager(current_user, department)
    assignee, users = finance_import_assignee(db, department)
    return BillsImportConfigOut(
        assigned_to_user_id=assignee.id,
        assignee_name=assignee.full_name_ar,
        users=[BillsImportAssignee(id=user.id, full_name_ar=user.full_name_ar, username=user.username) for user in users],
    )


@router.patch("/config", response_model=BillsImportConfigOut)
def update_bills_import_config(payload: BillsImportConfigUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    department = finance_department(db)
    require_finance_manager(current_user, department)
    users = finance_team_users(db, department)
    assignee = next((user for user in users if user.id == payload.assigned_to_user_id), None)
    if not assignee:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee must be an active Finance team user")
    department.billing_assignee_id = assignee.id
    db.commit()
    return BillsImportConfigOut(
        assigned_to_user_id=assignee.id,
        assignee_name=assignee.full_name_ar,
        users=[BillsImportAssignee(id=user.id, full_name_ar=user.full_name_ar, username=user.username) for user in users],
    )


@router.get("/history", response_model=list[BillsImportHistoryRow])
def bills_import_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_bills_importer(current_user)
    query = db.query(Task).options(joinedload(Task.attachments)).filter(Task.billing_import_key.is_not(None), Task.deleted_at.is_(None))
    if current_user.role == UserRole.bills_user:
        query = query.filter(Task.created_by_user_id == current_user.id)
    tasks = query.order_by(Task.created_at.desc(), Task.id.desc()).limit(500).all()
    return [history_row(task) for task in tasks]


@router.patch("/{task_id}", response_model=BillsImportHistoryRow)
def update_bills_import_history(
    task_id: int,
    payload: BillsImportHistoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_bills_importer(current_user)
    task = bills_task_or_403(db, task_id, current_user)
    customer_rep = clean_cell(payload.customer_rep or "")
    customer_name = clean_cell(payload.customer_name)
    material_name = clean_cell(payload.material_name)
    note = clean_note(payload.note or "")
    if not customer_name or not material_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Customer and material names are required")
    work_order_ids = unique_values((task.billing_work_order_id or "").split("،"))
    material_names = unique_values(material_name.split(" | "))
    title = grouped_bill_title(payload.task_date, customer_name, work_order_ids, material_names)
    if len(title) > 220:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The updated task name is longer than 220 characters")

    task.due_date = payload.task_date
    task.title = title
    task.billing_customer_rep = customer_rep or None
    task.billing_customer_name = customer_name
    task.billing_material_name = material_name
    task.billing_note = note or None
    task.billing_import_key = customer_group_key(payload.task_date, customer_name)
    task.description = billing_description(
        customer_rep,
        task.billing_work_order_id or "",
        customer_name,
        material_name,
        note,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A matching bill task already exists for this date")
    db.refresh(task)
    return history_row(task)


def sanad_notification_recipient_ids(db: Session, task: Task, uploader_id: int):
    recipients = {
        user_id
        for (user_id,) in (
            db.query(User.id)
            .filter(
                User.department_id == task.department_id,
                User.is_active.is_(True),
                User.role != UserRole.bills_user,
            )
            .all()
        )
    }
    recipients.discard(uploader_id)
    return recipients


@router.post("/{task_id}/sanad", response_model=BillsImportHistoryRow)
def upload_sanad(
    task_id: int,
    sanads: list[UploadFile] = File(..., alias="sanad"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_bills_importer(current_user)
    task = bills_task_or_403(db, task_id, current_user)
    existing_count = db.query(TaskAttachment).filter(TaskAttachment.task_id == task.id, TaskAttachment.attachment_kind == "sanad").count()
    if existing_count + len(sanads) > MAX_SANADS_PER_TASK:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"A bill task can have up to {MAX_SANADS_PER_TASK} sanad images")
    files = [read_sanad_image(sanad, task.id) for sanad in sanads]
    stored_filenames = []
    try:
        for original_filename, stored_filename, size, content, content_type in files:
            upload_object(stored_filename, content, content_type)
            stored_filenames.append(stored_filename)
            db.add(
                TaskAttachment(
                    task_id=task.id,
                    uploaded_by_user_id=current_user.id,
                    original_filename=original_filename,
                    stored_filename=stored_filename,
                    content_type=content_type,
                    size_bytes=size,
                    attachment_kind="sanad",
                )
            )
        recipients = sanad_notification_recipient_ids(db, task, current_user.id)
        count_label = f" ({len(files)})" if len(files) > 1 else ""
        for user_id in recipients:
            db.add(
                Notification(
                    user_id=user_id,
                    task_id=task.id,
                    title=f"تم إرفاق سند{count_label}",
                    message=f"تم إرفاق {len(files)} سند للمهمة: {task.title}" if len(files) > 1 else f"تم إرفاق سند للمهمة: {task.title}",
                    notification_type="sanad_attached",
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        delete_objects(stored_filenames)
        raise
    db.refresh(task)
    return history_row(task)


@router.get("/{task_id}/sanad")
def download_sanad(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_bills_importer(current_user)
    task = bills_task_or_403(db, task_id, current_user)
    attachment = db.query(TaskAttachment).filter(TaskAttachment.task_id == task.id, TaskAttachment.attachment_kind == "sanad").first()
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sanad image not found")
    content, content_type = download_object(attachment.stored_filename)
    safe_filename = attachment.original_filename.replace('"', "")
    return Response(
        content,
        media_type=attachment.content_type or content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.get("/{task_id}/sanads/{attachment_id}")
def download_specific_sanad(task_id: int, attachment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_bills_importer(current_user)
    task = bills_task_or_403(db, task_id, current_user)
    attachment = (
        db.query(TaskAttachment)
        .filter(
            TaskAttachment.id == attachment_id,
            TaskAttachment.task_id == task.id,
            TaskAttachment.attachment_kind == "sanad",
        )
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sanad image not found")
    content, content_type = download_object(attachment.stored_filename)
    safe_filename = attachment.original_filename.replace('"', "")
    return Response(
        content,
        media_type=attachment.content_type or content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bills_import_history(
    task_id: int,
    payload: TaskDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_bills_importer(current_user)
    task = bills_task_or_403(db, task_id, current_user)
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deletion reason is required")
    if task.status == TaskStatus.in_progress and task.timer_started_at:
        task.work_seconds = task.elapsed_seconds
        task.timer_started_at = None
    task.deleted_at = datetime.now(timezone.utc)
    task.deleted_by_user_id = current_user.id
    task.deletion_reason = reason

    department = db.query(Department).filter(Department.id == task.department_id).first()
    manager = None
    if department and department.manager_id:
        manager = db.query(User).filter(User.id == department.manager_id, User.is_active.is_(True)).first()
    if manager and manager.id != current_user.id:
        db.add(
            Notification(
                user_id=manager.id,
                title="تم حذف مهمة فاتورة",
                message=f"{current_user.full_name_ar} حذفت المهمة: {task.title}\nالسبب: {reason}",
                notification_type="bill_task_deleted",
            )
        )
    db.commit()


@router.post("/preview", response_model=BillsImportResult)
def preview_bills_import(payload: BillsImportRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_bills_importer(current_user)
    department, assignee, rows = inspect_import(db, payload)
    return result_for(department, assignee, rows)


@router.post("/commit", response_model=BillsImportResult)
def commit_bills_import(payload: BillsImportRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_bills_importer(current_user)
    department, assignee, rows = inspect_import(db, payload)
    if any(row["status"] == "invalid" for row in rows):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fix the invalid rows before confirming the import")
    ready_rows = [row for row in rows if row["status"] == "ready"]
    for row in ready_rows:
        task = Task(
            title=row["title"],
            description=row["description"],
            department_id=department.id,
            assigned_to_user_id=assignee.id,
            created_by_user_id=current_user.id,
            priority=TaskPriority.normal,
            status=TaskStatus.pending,
            expected_minutes=payload.expected_minutes,
            due_date=payload.task_date,
            billing_import_key=row["key"],
            billing_customer_rep=row["customer_rep"] or None,
            billing_work_order_id=row["work_order_id"],
            billing_customer_name=row["customer_name"],
            billing_material_name=row["material_name"],
            billing_note=row["note"] or None,
        )
        db.add(task)
        db.flush()
        db.add(TaskStatusHistory(task_id=task.id, old_status=None, new_status=TaskStatus.pending, changed_by_user_id=current_user.id))
        db.add(
            Notification(
                user_id=assignee.id,
                task_id=task.id,
                title="مهمة مالية جديدة",
                message=f"تم إسناد مهمة جديدة: {task.title}",
                notification_type="task_assigned",
            )
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This batch was already imported; preview it again")
    for row in ready_rows:
        row["status"] = "created"
        row["message"] = "تم إنشاء المهمة"
    return result_for(department, assignee, rows, created_count=len(ready_rows))
