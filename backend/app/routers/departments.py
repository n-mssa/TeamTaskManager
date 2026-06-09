from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Department, User
from ..permissions import require_admin
from ..schemas import DepartmentCreate, DepartmentOut, DepartmentUpdate

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role.value == "admin":
        return db.query(Department).order_by(Department.name_ar).all()
    if not current_user.department_id:
        return []
    return db.query(Department).filter(Department.id == current_user.department_id).all()


@router.post("", response_model=DepartmentOut)
def create_department(payload: DepartmentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    department = Department(**payload.model_dump())
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


@router.put("/{department_id}", response_model=DepartmentOut)
def update_department(department_id: int, payload: DepartmentUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    for key, value in payload.model_dump().items():
        setattr(department, key, value)
    db.commit()
    db.refresh(department)
    return department


@router.delete("/{department_id}")
def delete_department(department_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    db.delete(department)
    db.commit()
    return {"message": "deleted"}
