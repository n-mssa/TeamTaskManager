# team-tasks-manager

تطبيق داخلي عربي لإدارة مهام الفريق، منفصل عن مشروع pricing-engine ولا يستخدم المنافذ `8000` أو `5173`.

## المنافذ

- Backend: `0.0.0.0:8010`
- Frontend: `0.0.0.0:5174`
- PostgreSQL: `localhost:5433`

## تشغيل سريع باستخدام Docker

```powershell
docker compose up --build
```

بعد تشغيل الخدمات، افتح نافذة PowerShell ثانية وشغل seed:

```powershell
docker compose exec backend python seed.py
```

الروابط:

- Frontend: `http://localhost:5174`
- Backend docs: `http://localhost:8010/docs`

## تشغيل محلي على Windows

### 1. إعداد قاعدة البيانات

شغل PostgreSQL على منفذ `5433` وأنشئ قاعدة البيانات والمستخدم:

```powershell
createdb -h localhost -p 5433 -U postgres team_tasks
psql -h localhost -p 5433 -U postgres -c "CREATE USER task_user WITH PASSWORD 'task_password';"
psql -h localhost -p 5433 -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE team_tasks TO task_user;"
```

أو استخدم قاعدة بيانات Docker فقط:

```powershell
docker compose up db
```

### 2. إعداد backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

عدّل `backend\.env` إذا احتجت تغيير `DATABASE_URL` أو `SECRET_KEY`.

### 3. إنشاء الجداول وبيانات التجربة

إذا كانت قاعدة البيانات غير موجودة، أنشئها أولاً:

```powershell
.\.venv\Scripts\python create_database.py
```

الجداول تنشأ تلقائياً عند بدء FastAPI، ويمكن كذلك تشغيل seed مباشرة:

```powershell
python seed.py
```

### 4. تشغيل backend على منفذ 8010

```powershell
.\.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8010
```

### 5. إعداد frontend

افتح PowerShell جديد:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
```

### 6. تشغيل frontend على منفذ 5174

```powershell
npm run dev
```

## بيانات الدخول الافتراضية

- Admin: `admin` / `admin123`
- Manager: `manager_design` / `test123`
- Employee design: `employee_design` / `test123`
- Employee sales: `employee_sales` / `test123`

## الوصول من جهاز آخر على الشبكة

اعرف IP الجهاز الذي يشغل التطبيق:

```powershell
ipconfig
```

ثم افتح من الجهاز الآخر:

- Frontend: `http://YOUR-LAN-IP:5174`
- Backend docs: `http://YOUR-LAN-IP:8010/docs`

إذا منع Windows Firewall الاتصال، اسمح للمنفذين `8010` و `5174` للشبكة الخاصة Private Network.

## ملاحظات الصلاحيات

- الموظف يرى مهامه فقط.
- المدير يرى مهام قسمه فقط.
- المدير لا يستطيع إسناد مهمة خارج قسمه.
- المدير أو الموظف يحصل على `403` عند محاولة فتح مهمة خارج نطاقه.
- المدير والموظف يحصلان على تقارير ضمن نطاق صلاحياتهما فقط.
- سبب التأخير مطلوب عند تحويل المهمة إلى `delayed`.
- عند تحويل المهمة إلى `done` يتم تعبئة `completed_at` تلقائياً.
