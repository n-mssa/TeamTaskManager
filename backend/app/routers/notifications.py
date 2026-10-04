from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Department, Notification, User, UserRole
from ..schemas import BillsMessageConfig, BillsMessageCreate, BillsMessageResult, NotificationOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


def get_finance_department(db: Session):
    return (
        db.query(Department)
        .filter(
            (func.lower(func.coalesce(Department.name_en, "")) == "finance")
            | (Department.name_ar == "المالية")
        )
        .first()
    )


def can_message_bills_user(user: User, finance_department: Department | None):
    if not finance_department or not user.is_active:
        return False
    if user.role == UserRole.super_admin:
        return True
    return user.department_id == finance_department.id and user.role in {UserRole.manager, UserRole.employee}


@router.get("/bills-message/config", response_model=BillsMessageConfig)
def bills_message_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    department = get_finance_department(db)
    allowed = can_message_bills_user(current_user, department)
    recipient_count = 0
    if allowed:
        recipient_count = (
            db.query(User)
            .filter(User.role == UserRole.bills_user, User.is_active.is_(True))
            .count()
        )
    return BillsMessageConfig(can_send=allowed, recipient_count=recipient_count)


@router.post("/bills-message", response_model=BillsMessageResult)
def send_bills_message(
    payload: BillsMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    department = get_finance_department(db)
    if not can_message_bills_user(current_user, department):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Finance team only")
    message = " ".join(payload.message.split()).strip()
    if not message:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A message is required")
    recipients = (
        db.query(User)
        .filter(User.role == UserRole.bills_user, User.is_active.is_(True))
        .all()
    )
    if not recipients:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No active bills user is available")
    for recipient in recipients:
        db.add(
            Notification(
                user_id=recipient.id,
                title="رسالة من قسم المالية",
                message=f"{current_user.full_name_ar}: {message}",
                notification_type="finance_message",
            )
        )
    db.commit()
    return BillsMessageResult(sent_count=len(recipients))


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        query = query.filter(Notification.read_at.is_(None))
    return query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).all()


@router.get("/bills-todos", response_model=list[NotificationOut])
def list_bills_todos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.bills_user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bills user only")
    return (
        db.query(Notification)
        .filter(
            Notification.user_id == current_user.id,
            Notification.notification_type == "finance_message",
            Notification.read_at.is_(None),
        )
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .all()
    )


@router.patch("/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notification = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == current_user.id)
        .first()
    )
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if not notification.read_at:
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(notification)
    return notification


@router.patch("/read-all", response_model=list[NotificationOut])
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read_at.is_(None),
    )
    if current_user.role == UserRole.bills_user:
        query = query.filter(Notification.notification_type != "finance_message")
    notifications = query.order_by(Notification.created_at.desc(), Notification.id.desc()).all()
    now = datetime.now(timezone.utc)
    for notification in notifications:
        notification.read_at = now
    db.commit()
    return notifications
