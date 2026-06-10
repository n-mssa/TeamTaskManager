from datetime import date, datetime, timedelta, timezone

from app.auth import hash_password
from app.database import Base, SessionLocal, engine
from app.models import Department, DelayReason, Task, TaskPriority, TaskStatus, User, UserRole


DEPARTMENTS = ["الإدارة", "المبيعات", "التصميم", "الإنتاج", "الموارد البشرية", "الصيانة / IT"]
DELAY_REASONS = [
    "بانتظار موافقة الإدارة",
    "بانتظار معلومات من العميل",
    "بانتظار ملف أو تصميم",
    "مشكلة فنية",
    "ضغط عمل",
    "تغيير أولوية",
    "نقص مواد / موارد",
    "سبب آخر",
]


def get_or_create(db, model, defaults=None, **lookup):
    obj = db.query(model).filter_by(**lookup).first()
    if obj:
        return obj
    obj = model(**lookup, **(defaults or {}))
    db.add(obj)
    db.flush()
    return obj


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        departments = {name: get_or_create(db, Department, name_ar=name) for name in DEPARTMENTS}
        reasons = {name: get_or_create(db, DelayReason, name_ar=name) for name in DELAY_REASONS}

        admin = get_or_create(
            db,
            User,
            username="admin",
            defaults={
                "password_hash": hash_password("admin123"),
                "full_name_ar": "مدير النظام",
                "role": UserRole.admin,
                "department_id": departments["الإدارة"].id,
            },
        )
        manager_design = get_or_create(
            db,
            User,
            username="manager_design",
            defaults={
                "password_hash": hash_password("test123"),
                "full_name_ar": "قائد فريق التصميم",
                "role": UserRole.manager,
                "department_id": departments["التصميم"].id,
            },
        )
        employee_design = get_or_create(
            db,
            User,
            username="employee_design",
            defaults={
                "password_hash": hash_password("test123"),
                "full_name_ar": "موظف التصميم",
                "role": UserRole.employee,
                "department_id": departments["التصميم"].id,
            },
        )
        employee_sales = get_or_create(
            db,
            User,
            username="employee_sales",
            defaults={
                "password_hash": hash_password("test123"),
                "full_name_ar": "موظف المبيعات",
                "role": UserRole.employee,
                "department_id": departments["المبيعات"].id,
            },
        )
        departments["التصميم"].manager_id = manager_design.id

        if db.query(Task).count() == 0:
            today = date.today()
            tasks = [
                Task(
                    title="تصميم علبة اغاتي بقلاوة كيلو",
                    description="تجهيز تصميم العلبة ومراجعة المقاسات والألوان قبل الاعتماد.",
                    department_id=departments["التصميم"].id,
                    assigned_to_user_id=employee_design.id,
                    created_by_user_id=manager_design.id,
                    priority=TaskPriority.high,
                    status=TaskStatus.in_progress,
                    expected_minutes=180,
                    due_date=today + timedelta(days=2),
                    started_at=datetime.now(timezone.utc),
                ),
                Task(
                    title="كليشة حبيبة كنافة كيلو",
                    description="تحضير كليشة الطباعة والتأكد من وضوح العناصر والبيانات.",
                    department_id=departments["التصميم"].id,
                    assigned_to_user_id=employee_design.id,
                    created_by_user_id=manager_design.id,
                    priority=TaskPriority.normal,
                    status=TaskStatus.done,
                    expected_minutes=90,
                    due_date=today - timedelta(days=1),
                    completed_at=datetime.now(timezone.utc),
                ),
                Task(
                    title="قالب 20*20 لجين سعدالدين",
                    department_id=departments["المبيعات"].id,
                    assigned_to_user_id=employee_sales.id,
                    created_by_user_id=admin.id,
                    priority=TaskPriority.urgent,
                    status=TaskStatus.delayed,
                    expected_minutes=60,
                    due_date=today - timedelta(days=2),
                    delay_reason_id=reasons["بانتظار معلومات من العميل"].id,
                    delay_reason_text="العميل لم يرسل المواصفات النهائية بعد.",
                ),
                Task(
                    title="تعديل تصميم ستيكر منتج جديد",
                    department_id=departments["الإنتاج"].id,
                    assigned_to_user_id=employee_sales.id,
                    created_by_user_id=admin.id,
                    priority=TaskPriority.low,
                    status=TaskStatus.pending,
                    expected_minutes=45,
                    due_date=today - timedelta(days=3),
                ),
            ]
            db.add_all(tasks)
        db.commit()
        print("Seed data created.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
