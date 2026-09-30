from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_user
from ..database import get_db
from ..models import Department, RecurringTaskTemplate, User, UserRole
from ..permissions import assert_can_manage_task_payload
from ..schemas import RecurringTaskCreate, RecurringTaskOut, RecurringTaskUpdate
from ..services.recurring_tasks import generate_due_recurring_tasks


router = APIRouter(prefix="/recurring-tasks", tags=["recurring-tasks"])
AMMAN_TIME_ZONE = ZoneInfo("Asia/Amman")


def assert_can_manage_recurring_department(current_user: User, department: Department):
    if current_user.role == UserRole.super_admin:
        return
    if current_user.role == UserRole.manager and department.manager_id == current_user.id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the department manager or super admin can manage recurring tasks")


def get_visible_template_or_404(db: Session, template_id: int, current_user: User):
    template = db.query(RecurringTaskTemplate).filter(RecurringTaskTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring task template not found")
    department = db.query(Department).filter(Department.id == template.department_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    assert_can_manage_recurring_department(current_user, department)
    return template


@router.get("", response_model=list[RecurringTaskOut])
def list_recurring_tasks(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(RecurringTaskTemplate).options(joinedload(RecurringTaskTemplate.assignee))
    if current_user.role == UserRole.manager:
        department = db.query(Department).filter(Department.id == current_user.department_id).first()
        if not department:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
        assert_can_manage_recurring_department(current_user, department)
        query = query.filter(RecurringTaskTemplate.department_id == current_user.department_id)
    elif current_user.role != UserRole.super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager or super admin only")
    return query.order_by(RecurringTaskTemplate.is_active.desc(), RecurringTaskTemplate.id.desc()).all()


@router.post("", response_model=RecurringTaskOut)
def create_recurring_task(payload: RecurringTaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.start_date < datetime.now(AMMAN_TIME_ZONE).date():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Recurring task start date cannot be in the past")
    department = db.query(Department).filter(Department.id == payload.department_id).first()
    if not department or not department.recurring_tasks_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Recurring tasks are not enabled for this department")
    assert_can_manage_recurring_department(current_user, department)
    assignee = db.query(User).filter(User.id == payload.assigned_to_user_id, User.is_active.is_(True)).first()
    if not assignee:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee must be an active user")
    assert_can_manage_task_payload(db, current_user, payload.department_id, assignee)
    template = RecurringTaskTemplate(
        **payload.model_dump(),
        created_by_user_id=current_user.id,
        monthly_day=payload.start_date.day if payload.frequency == "monthly" else None,
        generation_hour=8,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    generate_due_recurring_tasks(db, datetime.now(AMMAN_TIME_ZONE))
    db.commit()
    db.refresh(template)
    return template


@router.patch("/{template_id}", response_model=RecurringTaskOut)
def update_recurring_task(template_id: int, payload: RecurringTaskUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    template = get_visible_template_or_404(db, template_id, current_user)
    template.is_active = payload.is_active
    db.commit()
    db.refresh(template)
    return template
