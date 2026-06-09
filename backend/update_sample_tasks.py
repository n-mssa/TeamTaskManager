from datetime import date, datetime, timedelta

from app.database import SessionLocal
from app.models import Task, TaskPriority, TaskStatus


SAMPLE_TASKS = [
    {
        "title": "تصميم علبة اغاتي بقلاوة كيلو",
        "description": "تجهيز تصميم العلبة ومراجعة المقاسات والألوان قبل الاعتماد.",
        "priority": TaskPriority.high,
        "status": TaskStatus.in_progress,
        "expected_minutes": 180,
        "due_date": date.today() + timedelta(days=2),
        "started_at": datetime.utcnow(),
    },
    {
        "title": "كليشة حبيبة كنافة كيلو",
        "description": "تحضير كليشة الطباعة والتأكد من وضوح العناصر والبيانات.",
        "priority": TaskPriority.normal,
        "status": TaskStatus.done,
        "expected_minutes": 90,
        "due_date": date.today() - timedelta(days=1),
        "completed_at": datetime.utcnow(),
    },
    {
        "title": "قالب 20*20 لجين سعدالدين",
        "description": "مراجعة قالب القص وتجهيز الملف النهائي للإنتاج.",
        "priority": TaskPriority.urgent,
        "status": TaskStatus.delayed,
        "expected_minutes": 60,
        "due_date": date.today() - timedelta(days=2),
        "delay_reason_text": "بانتظار اعتماد نهائي على المقاس.",
    },
    {
        "title": "تعديل تصميم ستيكر منتج جديد",
        "description": "تعديل بيانات المنتج وتجهيز نسخة مراجعة.",
        "priority": TaskPriority.low,
        "status": TaskStatus.pending,
        "expected_minutes": 45,
        "due_date": date.today() - timedelta(days=3),
    },
]


def main():
    db = SessionLocal()
    try:
        tasks = db.query(Task).order_by(Task.id.asc()).limit(len(SAMPLE_TASKS)).all()
        if not tasks:
            print("No tasks found. Run seed.py first.")
            return
        for task, sample in zip(tasks, SAMPLE_TASKS):
            for key, value in sample.items():
                setattr(task, key, value)
        db.commit()
        print("Sample tasks updated.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
