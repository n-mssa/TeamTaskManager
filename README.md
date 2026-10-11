# TeamTaskManager

Arabic-first internal task management system for National Factory teams. The application combines a React dashboard with a FastAPI API, PostgreSQL, role-based access, reports, task timers, recurring work, file attachments, and a dedicated Finance bills workflow.

Production URL: `https://ttm.nationalf.com`

## Stack

- Frontend: React 18 and Vite 5
- Backend: FastAPI, SQLAlchemy 2, and Uvicorn
- Database: PostgreSQL
- Authentication: JWT bearer tokens with bcrypt password hashes
- Storage: local VPS storage or a private Supabase Storage bucket
- Production proxy and TLS: Caddy
- Production service manager: systemd

## Main Features

- Arabic right-to-left interface with light and dark themes
- Kanban task board, expected-time tracking, status history, comments, and notifications
- Department-scoped access and restricted departments
- Date-filtered operational, executive, and KPI reports
- Employee-created tasks with manager approval
- Daily and monthly recurring tasks generated at 08:00 Asia/Amman; daily schedules skip Fridays
- Server-side end-of-day pause at 17:00 Asia/Amman
- Split tasks with shared elapsed time and shared sanad attachments
- Local or Supabase-backed task attachments
- Finance task templates for invoices and receipt vouchers
- Dedicated bills-import interface and persistent Finance requests for the bills user

## Roles And Access

| Role | Access |
| --- | --- |
| `super_admin` | Full system access, including restricted departments and the executive report |
| `admin` | Administrative access to non-restricted departments |
| `manager` | Tasks, reports, recurring templates, and users within the manager's department |
| `employee` | The employee's own tasks and personal report |
| `bills_user` | Dedicated Finance bills-import screen and upload history only |

A restricted department is visible only to the super administrator and that department's manager. Create a department without a manager when necessary, create the manager account, then assign that manager from the Departments screen.

## Repository Layout

```text
backend/
  app/                  FastAPI application, routers, services, and migrations
  tests/                Backend lifecycle and permission tests
  provision_superadmin.py
frontend/
  src/                  React application
docker-compose.yml      Local development stack
DEPLOYMENT.md           Legacy Supabase and Render deployment notes
```

## Local Development On Windows

### Prerequisites

- Python 3.12
- Node.js 20 or newer
- PostgreSQL 16 or newer, or Docker Desktop

### 1. Start PostgreSQL

The simplest local option is the database service in Docker Compose:

```powershell
docker compose up -d db
```

It exposes PostgreSQL on `localhost:5433` with the development database configured in `docker-compose.yml`.

### 2. Configure And Run The Backend

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Generate a local JWT secret and place it in `backend\.env` as `SECRET_KEY`:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Then start the API:

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8010 --reload
```

The application creates missing tables and applies its idempotent migrations during startup.

### 3. Configure And Run The Frontend

Open another PowerShell window:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open:

- Application: `http://localhost:5174`
- API documentation: `http://localhost:8010/docs`
- API health: `http://localhost:8010/health`

Do not run `seed.py` against production. It creates sample records and is intended only for disposable development databases.

## Environment Variables

### Backend

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLAlchemy PostgreSQL URL, preferably using `postgresql+psycopg://` |
| `SECRET_KEY` | Long random secret used to sign authentication tokens |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token lifetime; defaults to `720` |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins |
| `STORAGE_BACKEND` | `local` or `supabase`; defaults to `supabase` |
| `LOCAL_STORAGE_ROOT` | Local storage root, normally `/opt/teamtaskmanager/uploads` |
| `LOCAL_STORAGE_BUCKET` | Local attachment bucket directory, normally `task-attachments` |
| `SUPABASE_URL` | Supabase project URL when Supabase storage is used |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only Supabase service-role key |
| `SUPABASE_STORAGE_BUCKET` | Supabase bucket name, normally `task-attachments` |

### Frontend

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | API base URL; use `http://localhost:8010` locally or `/api` behind Caddy |

Never commit `.env`, `.env.production`, database passwords, JWT secrets, or Supabase service-role keys.

## Create Or Reset The Super Administrator

After the database and backend environment are configured:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python provision_superadmin.py
```

The script securely prompts for a password, creates or resets the `superadmin` account, and ensures all other administrators remain ordinary `admin` users. No default production password is stored in this repository.

## Finance Workflow

### Department Configuration

From the Departments screen, the super administrator can:

- mark Finance as restricted;
- assign its manager;
- enable recurring tasks; and
- choose the default user who receives imported bill tasks.

### Bills Import Format

The bills user pastes tab-separated rows copied from Excel in this order:

```text
Customer representative<TAB>Work order ID<TAB>Customer name<TAB>Material name<TAB>Optional note
```

Example:

```text
مندوب تجريبي	TEST-001	شركة تجريبية	مادة تجريبية	ملاحظة اختيارية
```

Import behavior:

- rows with the same customer are grouped into one task for that import;
- exact duplicate rows are skipped, but new bills for the same customer and date are allowed;
- plain-bag orders without a work-order number may use `0`;
- the user previews and confirms tasks before creation;
- imported task names, dates, and notes can be edited without changing the assignee;
- multiple sanad images can be attached later from upload history;
- deleting an imported task requires a reason and notifies the Finance manager; and
- Finance can send persistent requests to the bills user's to-do list.

## Task Timing Rules

- Moving a task into progress starts its timer.
- Split task parts share one elapsed-time total and their original expected time.
- At 17:00 Asia/Amman, the backend moves still-running tasks to `blocked` with reason `END OF DAY`.
- The backend scheduler runs every minute and also catches a missed cutoff after a service restart.
- Daily recurring tasks are generated at 08:00 and skip Friday; monthly tasks use the selected day.

The scheduler runs inside the API process. Production should therefore run one Uvicorn worker unless scheduler leadership is moved to a separate service.

## Production Deployment On The VPS

The current production layout is:

```text
/opt/teamtaskmanager/app       Git checkout
/opt/teamtaskmanager/uploads   Persistent local attachments
PostgreSQL                     Local database
systemd                        FastAPI process
Caddy                          HTTPS and static frontend
```

### Backend Environment

Create `/opt/teamtaskmanager/app/backend/.env` with permissions `600`:

```env
DATABASE_URL=postgresql+psycopg://teamtaskmanager:URL_ENCODED_PASSWORD@127.0.0.1:5432/teamtaskmanager
SECRET_KEY=GENERATE_A_LONG_RANDOM_VALUE
ACCESS_TOKEN_EXPIRE_MINUTES=720
CORS_ORIGINS=https://ttm.nationalf.com
STORAGE_BACKEND=local
LOCAL_STORAGE_ROOT=/opt/teamtaskmanager/uploads
LOCAL_STORAGE_BUCKET=task-attachments
```

If the database password contains reserved URL characters, URL-encode it before placing it in `DATABASE_URL`.

### systemd Service

`/etc/systemd/system/teamtaskmanager-api.service`:

```ini
[Unit]
Description=TeamTaskManager FastAPI backend
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/teamtaskmanager/app/backend
EnvironmentFile=/opt/teamtaskmanager/app/backend/.env
ExecStart=/opt/teamtaskmanager/app/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

The service currently uses `root` because the existing deployment and upload files are root-owned. A dedicated service account is preferable after file ownership is migrated deliberately.

### Frontend And Caddy

Build with the same-origin API path:

```bash
cd /opt/teamtaskmanager/app/frontend
printf 'VITE_API_BASE_URL=/api\n' > .env.production
npm ci
npm run build
```

Example Caddy site:

```caddyfile
ttm.nationalf.com {
    encode gzip zstd

    handle_path /api/* {
        reverse_proxy 127.0.0.1:8010
    }

    handle {
        root * /opt/teamtaskmanager/app/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
```

Validate and reload Caddy after editing its configuration:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Deploy An Update

```bash
cd /opt/teamtaskmanager/app
git pull origin main

cd backend
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart teamtaskmanager-api
sleep 3
curl http://localhost:8010/health
curl http://localhost:8010/health/storage

cd ../frontend
npm ci
npm run build
sudo systemctl reload caddy
```

Useful diagnostics:

```bash
sudo systemctl status teamtaskmanager-api --no-pager
sudo journalctl -u teamtaskmanager-api -n 100 --no-pager
curl http://localhost:8010/health/storage-config
```

## Backup And Restore

A PostgreSQL dump does not include uploaded attachment files. Back up both the database and `/opt/teamtaskmanager/uploads`.

Create a database backup:

```bash
pg_dump -Fc --no-owner --no-acl \
  -f "/root/teamtaskmanager_$(date +%F).dump" \
  "postgresql://teamtaskmanager:URL_ENCODED_PASSWORD@127.0.0.1:5432/teamtaskmanager"
```

Back up attachments:

```bash
sudo tar -czf "/root/teamtaskmanager_uploads_$(date +%F).tar.gz" \
  -C /opt/teamtaskmanager uploads
```

Restore into an empty database:

```bash
sudo -u postgres createdb -O teamtaskmanager teamtaskmanager
sudo -u postgres pg_restore \
  -d teamtaskmanager \
  --no-owner \
  --no-acl \
  /path/to/teamtaskmanager.dump
```

If a dump was restored by `postgres`, transfer ownership of the schema, tables, and sequences to the application database user before starting the API. The API applies schema migrations on startup, so always take a fresh backup before deploying a version that changes the database.

## Verification

Frontend production build:

```powershell
cd frontend
npm run build
```

Backend tests:

```powershell
cd backend
.\.venv\Scripts\python -m pytest -q
```

Before committing, confirm that no environment or backup files are staged:

```powershell
git status --short
git diff --check
```
