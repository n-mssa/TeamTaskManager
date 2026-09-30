import csv
from datetime import date
from hashlib import sha256
from html import unescape
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Department, Notification, Task, TaskPriority, TaskStatus, TaskStatusHistory, User, UserRole
from ..schemas import BillsImportRequest, BillsImportResult, BillsImportRow

router = APIRouter(prefix="/bills-import", tags=["bills import"])


def require_bills_importer(user: User):
    if user.role not in {UserRole.bills_user, UserRole.super_admin}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bills import access only")


def finance_department_and_manager(db: Session):
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
    manager = db.query(User).filter(User.id == department.manager_id, User.is_active.is_(True)).first()
    if not manager or manager.role != UserRole.manager or manager.department_id != department.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Finance department needs an active team manager")
    return department, manager


def clean_cell(value: str) -> str:
    return " ".join(unescape(value or "").replace("\u00a0", " ").split()).strip()


def title_date(value: date) -> str:
    return f"{value.month}/{value.day}/{value.year}"


def row_key(task_date: date, work_order_id: str, customer_name: str, material_name: str) -> str:
    source = "|".join((task_date.isoformat(), work_order_id.casefold(), customer_name.casefold(), material_name.casefold()))
    return sha256(source.encode("utf-8")).hexdigest()


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
        if len(cells) < 4:
            cells.extend([""] * (4 - len(cells)))
        customer_rep, work_order_id, customer_name = cells[:3]
        material_name = clean_cell(" ".join(cells[3:]))
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
        rows.append(
            {
                "row_number": source_row,
                "customer_rep": customer_rep,
                "work_order_id": work_order_id,
                "customer_name": customer_name,
                "material_name": material_name,
                "title": title,
                "key": row_key(task_date, work_order_id, customer_name, material_name) if not message else None,
                "status": "invalid" if message else "ready",
                "message": message,
            }
        )
    return rows


def inspect_import(db: Session, payload: BillsImportRequest):
    department, manager = finance_department_and_manager(db)
    rows = parse_rows(payload.pasted_text, payload.task_date)
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No task rows were found in the pasted text")
    keys = [row["key"] for row in rows if row["key"]]
    existing = {
        value for (value,) in db.query(Task.billing_import_key).filter(Task.billing_import_key.in_(keys)).all()
    } if keys else set()
    seen = set()
    for row in rows:
        key = row["key"]
        if not key or row["status"] == "invalid":
            continue
        if key in existing or key in seen:
            row["status"] = "duplicate"
            row["message"] = "تمت إضافة هذا الصف مسبقاً" if key in existing else "الصف مكرر داخل هذه الدفعة"
        seen.add(key)
    return department, manager, rows


def result_for(department: Department, manager: User, rows: list[dict], created_count: int = 0):
    return BillsImportResult(
        department_name=department.name_ar,
        assignee_name=manager.full_name_ar,
        rows=[BillsImportRow(**{key: value for key, value in row.items() if key != "key"}) for row in rows],
        ready_count=sum(row["status"] == "ready" for row in rows),
        duplicate_count=sum(row["status"] == "duplicate" for row in rows),
        invalid_count=sum(row["status"] == "invalid" for row in rows),
        created_count=created_count,
    )


@router.post("/preview", response_model=BillsImportResult)
def preview_bills_import(payload: BillsImportRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_bills_importer(current_user)
    department, manager, rows = inspect_import(db, payload)
    return result_for(department, manager, rows)


@router.post("/commit", response_model=BillsImportResult)
def commit_bills_import(payload: BillsImportRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_bills_importer(current_user)
    department, manager, rows = inspect_import(db, payload)
    if any(row["status"] == "invalid" for row in rows):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fix the invalid rows before confirming the import")
    ready_rows = [row for row in rows if row["status"] == "ready"]
    for row in ready_rows:
        task = Task(
            title=row["title"],
            description=(
                f"مسؤول الزبون: {row['customer_rep'] or '-'}\n"
                f"رقم أمر العمل: {row['work_order_id']}\n"
                f"اسم العميل: {row['customer_name']}\n"
                f"اسم المادة: {row['material_name']}"
            ),
            department_id=department.id,
            assigned_to_user_id=manager.id,
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
        )
        db.add(task)
        db.flush()
        db.add(TaskStatusHistory(task_id=task.id, old_status=None, new_status=TaskStatus.pending, changed_by_user_id=current_user.id))
        db.add(
            Notification(
                user_id=manager.id,
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
    return result_for(department, manager, rows, created_count=len(ready_rows))
