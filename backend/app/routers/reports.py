from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User
from ..services.reports import weekly_report

router = APIRouter(prefix="/reports", tags=["reports"])


def current_sunday_week():
    today = date.today()
    days_since_sunday = (today.weekday() + 1) % 7
    start = today - timedelta(days=days_since_sunday)
    return start, start + timedelta(days=6)


@router.get("/weekly")
def get_weekly_report(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    department_id: Optional[int] = None,
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    default_start, default_end = current_sunday_week()
    return weekly_report(db, current_user, start_date or default_start, end_date or default_end, department_id, user_id)
