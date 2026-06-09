from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

from app.database import DATABASE_URL


def database_name(url: str) -> str:
    path = urlsplit(url).path.lstrip("/")
    if not path:
        raise RuntimeError("DATABASE_URL must include a database name.")
    return path


def server_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/postgres", "", ""))


def main():
    load_dotenv()
    db_name = database_name(DATABASE_URL)
    engine = create_engine(server_url(DATABASE_URL), isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": db_name}).scalar()
        if exists:
            print(f'Database "{db_name}" already exists.')
            return
        quoted_name = '"' + db_name.replace('"', '""') + '"'
        conn.execute(text(f"CREATE DATABASE {quoted_name}"))
        print(f'Database "{db_name}" created.')


if __name__ == "__main__":
    main()
