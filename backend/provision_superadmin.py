from getpass import getpass

from app.auth import hash_password
from app.database import SessionLocal
from app.migrations import apply_migrations
from app.models import User, UserRole


SUPER_ADMIN_USERNAME = "superadmin"


def main():
    apply_migrations()
    password = getpass("New superadmin password: ")
    confirmation = getpass("Confirm password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    if len(password) < 8:
        raise SystemExit("Password must be at least 8 characters.")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == SUPER_ADMIN_USERNAME).first()
        if user is None:
            user = User(
                username=SUPER_ADMIN_USERNAME,
                password_hash=hash_password(password),
                full_name_ar="مدير النظام الأعلى",
                role=UserRole.super_admin,
                department_id=None,
                is_active=True,
            )
            db.add(user)
            db.flush()
        else:
            user.password_hash = hash_password(password)
            user.role = UserRole.super_admin
            user.is_active = True

        db.query(User).filter(
            User.role == UserRole.super_admin,
            User.id != user.id,
        ).update({User.role: UserRole.admin}, synchronize_session=False)
        db.commit()
        print("The superadmin account is ready. All other administrators remain ordinary admins.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
