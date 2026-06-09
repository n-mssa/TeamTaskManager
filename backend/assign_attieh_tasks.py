from datetime import date, timedelta

from app.database import SessionLocal
from app.models import Task, TaskPriority, TaskStatus, User


TASKS_TO_CREATE = [
    {
        "title": "تصميم بوكس معمول فاخر",
        "description": "تجهيز اتجاه تصميم جديد مع ألوان هادئة وملف مراجعة.",
        "priority": TaskPriority.high,
        "status": TaskStatus.pending,
        "expected_minutes": 120,
        "due_date": date.today() + timedelta(days=3),
    },
    {
        "title": "تعديل كرتونة تمر ميدجول",
        "description": "تعديل النصوص والمقاسات وتجهيز نسخة للطباعة.",
        "priority": TaskPriority.normal,
        "status": TaskStatus.blocked,
        "expected_minutes": 75,
        "due_date": date.today() + timedelta(days=1),
    },
]


def main():
    db = SessionLocal()
    try:
        attieh = db.query(User).filter(User.username == "attieh").first()
        if not attieh:
            print("User attieh not found.")
            return

        creator = db.query(User).filter(User.role == "manager", User.department_id == attieh.department_id).first()
        if not creator:
            creator = db.query(User).filter(User.role == "admin").first()

        existing = (
            db.query(Task)
            .filter(Task.department_id == attieh.department_id)
            .order_by(Task.id.asc())
            .limit(2)
            .all()
        )
        for task in existing:
            task.assigned_to_user_id = attieh.id

        for payload in TASKS_TO_CREATE:
            already_exists = db.query(Task).filter(Task.title == payload["title"]).first()
            if already_exists:
                already_exists.assigned_to_user_id = attieh.id
                already_exists.department_id = attieh.department_id
                continue
            db.add(
                Task(
                    **payload,
                    department_id=attieh.department_id,
                    assigned_to_user_id=attieh.id,
                    created_by_user_id=creator.id,
                )
            )

        db.commit()
        count = db.query(Task).filter(Task.assigned_to_user_id == attieh.id).count()
        print(f"attieh now has {count} assigned tasks.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
