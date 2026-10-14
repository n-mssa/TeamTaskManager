from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Department, DirectMessage, Notification, User, UserRole
from ..schemas import ChatContactOut, DirectMessageCreate, DirectMessageOut


router = APIRouter(prefix="/messages", tags=["messages"])
ADMIN_ROLES = {UserRole.super_admin, UserRole.admin}
CHAT_ROLES = ADMIN_ROLES | {UserRole.employee}


def require_chat_user(user: User):
    if user.role not in CHAT_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chat is available to administrators and employees")


def employee_department_is_restricted(db: Session, employee: User) -> bool:
    if not employee.department_id:
        return False
    department = db.query(Department).filter(Department.id == employee.department_id).first()
    return bool(department and department.is_restricted)


def admin_can_message_employee(db: Session, admin: User, employee: User) -> bool:
    if admin.role not in ADMIN_ROLES or employee.role != UserRole.employee or not employee.is_active:
        return False
    return admin.role == UserRole.super_admin or not employee_department_is_restricted(db, employee)


def pair_filter(first_id: int, second_id: int):
    return or_(
        and_(DirectMessage.sender_id == first_id, DirectMessage.recipient_id == second_id),
        and_(DirectMessage.sender_id == second_id, DirectMessage.recipient_id == first_id),
    )


def conversation_exists(db: Session, first_id: int, second_id: int) -> bool:
    return db.query(DirectMessage.id).filter(pair_filter(first_id, second_id)).first() is not None


def assert_chat_pair(db: Session, current_user: User, other_user: User, allow_employee_initiation: bool = False):
    require_chat_user(current_user)
    if not other_user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This user is inactive")
    if current_user.role in ADMIN_ROLES:
        if not admin_can_message_employee(db, current_user, other_user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This employee is outside your chat permissions")
        return
    if other_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employees can reply only to administrators")
    if other_user.role == UserRole.admin and employee_department_is_restricted(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Restricted department conversations require the super admin")
    if not allow_employee_initiation and not conversation_exists(db, current_user.id, other_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="An administrator must start the conversation")


def visible_admin_contacts(db: Session, employee: User) -> list[User]:
    participant_rows = (
        db.query(DirectMessage.sender_id, DirectMessage.recipient_id)
        .filter(or_(DirectMessage.sender_id == employee.id, DirectMessage.recipient_id == employee.id))
        .all()
    )
    participant_ids = {
        sender_id if recipient_id == employee.id else recipient_id
        for sender_id, recipient_id in participant_rows
    }
    if not participant_ids:
        return []
    query = db.query(User).filter(User.id.in_(participant_ids), User.role.in_(ADMIN_ROLES), User.is_active.is_(True))
    if employee_department_is_restricted(db, employee):
        query = query.filter(User.role == UserRole.super_admin)
    return query.all()


@router.get("/contacts", response_model=list[ChatContactOut])
def list_chat_contacts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_chat_user(current_user)
    if current_user.role in ADMIN_ROLES:
        query = db.query(User).filter(User.role == UserRole.employee, User.is_active.is_(True))
        if current_user.role == UserRole.admin:
            query = query.filter(~User.department.has(Department.is_restricted.is_(True)))
        contacts = query.order_by(User.full_name_ar.asc()).all()
    else:
        contacts = visible_admin_contacts(db, current_user)

    contact_ids = [contact.id for contact in contacts]
    departments = {
        item.id: item.name_ar
        for item in db.query(Department).filter(Department.id.in_([item.department_id for item in contacts if item.department_id])).all()
    } if contact_ids else {}
    messages = (
        db.query(DirectMessage)
        .filter(
            or_(DirectMessage.sender_id == current_user.id, DirectMessage.recipient_id == current_user.id),
            or_(DirectMessage.sender_id.in_(contact_ids), DirectMessage.recipient_id.in_(contact_ids)),
        )
        .order_by(DirectMessage.created_at.desc(), DirectMessage.id.desc())
        .all()
    ) if contact_ids else []
    latest_by_contact = {}
    unread_by_contact = {}
    for message in messages:
        contact_id = message.sender_id if message.recipient_id == current_user.id else message.recipient_id
        latest_by_contact.setdefault(contact_id, message)
        if message.recipient_id == current_user.id and message.read_at is None:
            unread_by_contact[contact_id] = unread_by_contact.get(contact_id, 0) + 1

    result = []
    for contact in contacts:
        latest = latest_by_contact.get(contact.id)
        result.append(
            ChatContactOut(
                id=contact.id,
                full_name_ar=contact.full_name_ar,
                role=contact.role,
                department_id=contact.department_id,
                department_name=departments.get(contact.department_id),
                last_message=latest.body if latest else None,
                last_message_at=latest.created_at if latest else None,
                unread_count=unread_by_contact.get(contact.id, 0),
            )
        )
    return sorted(result, key=lambda item: (item.last_message_at is not None, item.last_message_at or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)


@router.get("/{other_user_id}", response_model=list[DirectMessageOut])
def get_conversation(
    other_user_id: int,
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    other_user = db.query(User).filter(User.id == other_user_id).first()
    if not other_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    assert_chat_pair(db, current_user, other_user)
    messages = (
        db.query(DirectMessage)
        .filter(pair_filter(current_user.id, other_user.id))
        .order_by(DirectMessage.created_at.desc(), DirectMessage.id.desc())
        .limit(limit)
        .all()
    )
    return list(reversed(messages))


@router.post("", response_model=DirectMessageOut)
def send_direct_message(
    payload: DirectMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipient = db.query(User).filter(User.id == payload.recipient_id).first()
    if not recipient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")
    assert_chat_pair(db, current_user, recipient)
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message cannot be empty")
    message = DirectMessage(sender_id=current_user.id, recipient_id=recipient.id, body=body)
    db.add(message)
    db.add(
        Notification(
            user_id=recipient.id,
            related_user_id=current_user.id,
            title=f"رسالة جديدة من {current_user.full_name_ar}",
            message=body,
            notification_type="direct_message",
        )
    )
    db.commit()
    db.refresh(message)
    return message


@router.patch("/{other_user_id}/read", response_model=list[DirectMessageOut])
def mark_conversation_read(
    other_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    other_user = db.query(User).filter(User.id == other_user_id).first()
    if not other_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    assert_chat_pair(db, current_user, other_user)
    unread = (
        db.query(DirectMessage)
        .filter(
            DirectMessage.sender_id == other_user.id,
            DirectMessage.recipient_id == current_user.id,
            DirectMessage.read_at.is_(None),
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    for message in unread:
        message.read_at = now
    (
        db.query(Notification)
        .filter(
            Notification.user_id == current_user.id,
            Notification.related_user_id == other_user.id,
            Notification.notification_type == "direct_message",
            Notification.read_at.is_(None),
        )
        .update({Notification.read_at: now}, synchronize_session=False)
    )
    db.commit()
    return unread
