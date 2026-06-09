from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import DelayReason, User
from ..permissions import require_admin
from ..schemas import DelayReasonCreate, DelayReasonOut, DelayReasonUpdate

router = APIRouter(prefix="/delay-reasons", tags=["delay reasons"])


@router.get("", response_model=list[DelayReasonOut])
def list_delay_reasons(active_only: bool = True, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(DelayReason)
    if active_only:
        query = query.filter(DelayReason.is_active.is_(True))
    return query.order_by(DelayReason.name_ar).all()


@router.post("", response_model=DelayReasonOut)
def create_delay_reason(payload: DelayReasonCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    reason = DelayReason(**payload.model_dump())
    db.add(reason)
    db.commit()
    db.refresh(reason)
    return reason


@router.put("/{reason_id}", response_model=DelayReasonOut)
def update_delay_reason(reason_id: int, payload: DelayReasonUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    reason = db.query(DelayReason).filter(DelayReason.id == reason_id).first()
    if not reason:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delay reason not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(reason, key, value)
    db.commit()
    db.refresh(reason)
    return reason


@router.patch("/{reason_id}/deactivate", response_model=DelayReasonOut)
def deactivate_delay_reason(reason_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    reason = db.query(DelayReason).filter(DelayReason.id == reason_id).first()
    if not reason:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delay reason not found")
    reason.is_active = False
    db.commit()
    db.refresh(reason)
    return reason
