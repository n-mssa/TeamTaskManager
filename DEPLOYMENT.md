# Deploy with Supabase and Render

Supabase hosts this application's PostgreSQL database. Render hosts the FastAPI
backend and the React frontend. Linking GitHub to Supabase does not deploy the
FastAPI or React services.

## 1. Create the Supabase database

1. Create a Supabase project.
2. In the project dashboard, click **Connect**.
3. Copy the **Session pooler** connection string on port `5432`.
4. Add `?sslmode=require` to the URL if it has no query string.

The result should look like:

```text
postgresql://postgres.PROJECT_REF:DB_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require
```

Do not commit this URL. The backend automatically converts provider-supplied
`postgresql://` URLs to the installed Psycopg 3 SQLAlchemy driver.

## 2. Deploy from GitHub on Render

1. Push this repository to GitHub.
2. In Render, create a new **Blueprint** and select the repository.
3. Render reads `render.yaml` and creates:
   - `team-task-manager-api`: FastAPI web service
   - `team-task-manager`: React static site
4. Enter the requested environment variables:
   - API `DATABASE_URL`: the Supabase Session pooler URL
   - API `CORS_ORIGINS`: the final frontend URL, such as
     `https://team-task-manager.onrender.com`
   - Frontend `VITE_API_BASE_URL`: the final API URL, such as
     `https://team-task-manager-api.onrender.com`
5. Redeploy both services after entering their final URLs.

The API creates and updates its tables during startup. Verify it at:

```text
https://YOUR-API.onrender.com/health
```

The Blueprint pins the API to Python 3.12 because some pinned backend
dependencies do not currently build on Python 3.14.

## 3. Add initial data

The seed script creates sample users and tasks with known passwords. Only run it
if you need those sample records, and change the passwords immediately.

From `backend` in PowerShell:

```powershell
$env:DATABASE_URL="YOUR_SUPABASE_SESSION_POOLER_URL"
$env:SECRET_KEY="YOUR_DEPLOYED_SECRET_KEY"
.\.venv\Scripts\python seed.py
```

## Important notes

- Keep `DATABASE_URL` and `SECRET_KEY` only in environment variables.
- Use the Supabase Session pooler, not the direct connection, when the backend
  host does not support IPv6.
- Supabase is used only as PostgreSQL here. Existing app authentication and
  authorization remain in FastAPI.
- The Supabase free database and Render free API are suitable for demos and
  light internal use, but free services may pause or sleep.
