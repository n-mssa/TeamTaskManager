from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user, hash_password
from ..database import get_db
from ..models import Department, Task, User, UserRole
from ..permissions import is_super_admin, require_admin
from ..schemas import PasswordReset, ThemePreference, UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


def assert_admin_can_manage_user(db: Session, current_user: User, user: User):
    if is_super_admin(current_user):
        return
    if user.role in {UserRole.super_admin, UserRole.bills_user}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin accounts and bills users can only be managed by a super admin")
    if user.department_id:
        department = db.query(Department).filter(Department.id == user.department_id).first()
        if department and department.is_restricted:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This user belongs to a restricted department")


def assert_admin_payload_allowed(
    db: Session,
    current_user: User,
    role: UserRole | None,
    department_id: int | None,
    allow_existing_super_admin: bool = False,
):
    if role == UserRole.super_admin and not allow_existing_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Use the server provisioning command to create the super admin")
    if role == UserRole.bills_user and not is_super_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a super admin can manage bills users")
    if is_super_admin(current_user):
        return
    if department_id:
        department = db.query(Department).filter(Department.id == department_id).first()
        if not department:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department not found")
        if department.is_restricted:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This department is restricted")


def sync_department_manager(db: Session, user: User):
    db.query(Department).filter(
        Department.manager_id == user.id,
        Department.id != user.department_id,
    ).update({Department.manager_id: None}, synchronize_session=False)
    if user.role != UserRole.manager or not user.department_id or not user.is_active:
        db.query(Department).filter(Department.manager_id == user.id).update(
            {Department.manager_id: None}, synchronize_session=False
        )
        return
    department = db.query(Department).filter(Department.id == user.department_id).first()
    if department:
        department.manager_id = user.id


@router.get("", response_model=list[UserOut])
def list_users(active_only: bool = False, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role in {UserRole.employee, UserRole.bills_user}:
        return [current_user]
    query = db.query(User)
    if current_user.role.value == "manager":
        query = query.filter(User.department_id == current_user.department_id)
    elif current_user.role == UserRole.admin:
        query = query.filter(
            User.role.notin_([UserRole.super_admin, UserRole.bills_user]),
            ~User.department.has(Department.is_restricted.is_(True)),
        )
    if active_only:
        query = query.filter(User.is_active.is_(True))
    return query.order_by(User.full_name_ar).all()


@router.post("", response_model=UserOut)
def create_user(payload: UserCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    assert_admin_payload_allowed(db, current_user, payload.role, payload.department_id)
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")
    data = payload.model_dump(exclude={"password"})
    if payload.role == UserRole.bills_user:
        data["department_id"] = None
    user = User(**data, password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    sync_department_manager(db, user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/me/theme", response_model=UserOut)
def update_own_theme(payload: ThemePreference, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.theme_id = payload.theme_id
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role in {UserRole.employee, UserRole.bills_user} and user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if current_user.role.value == "manager" and user.department_id != current_user.department_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    if current_user.role == UserRole.admin:
        assert_admin_can_manage_user(db, current_user, user)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    assert_admin_can_manage_user(db, current_user, user)
    data = payload.model_dump(exclude_unset=True)
    next_role = data.get("role", user.role)
    assert_admin_payload_allowed(
        db,
        current_user,
        next_role,
        data.get("department_id", user.department_id),
        allow_existing_super_admin=user.role == UserRole.super_admin and next_role == UserRole.super_admin,
    )
    if next_role == UserRole.bills_user:
        data["department_id"] = None
    if user.role == UserRole.super_admin and data.get("username", user.username).lower() != "superadmin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The superadmin username cannot be changed")
    if "username" in data and db.query(User).filter(User.username == data["username"], User.id != user_id).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")
    if user_id == current_user.id and (data.get("role") not in {None, current_user.role} or data.get("is_active") is False):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot remove your own admin access")
    department_changed = "department_id" in data and data["department_id"] != user.department_id
    for key, value in data.items():
        setattr(user, key, value)
    db.flush()
    sync_department_manager(db, user)
    if department_changed and user.department_id:
        (
            db.query(Task)
            .filter(Task.assigned_to_user_id == user.id, Task.deleted_at.is_(None))
            .update({Task.department_id: user.department_id}, synchronize_session=False)
        )
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/deactivate", response_model=UserOut)
def deactivate_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    assert_admin_can_manage_user(db, current_user, user)
    user.is_active = False
    db.flush()
    sync_department_manager(db, user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/reset-password", response_model=UserOut)
def reset_password(user_id: int, payload: PasswordReset, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    assert_admin_can_manage_user(db, current_user, user)
    user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return user
