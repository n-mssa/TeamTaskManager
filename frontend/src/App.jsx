import { useEffect, useState } from 'react'
import { BarChart3, Building2, ClipboardList, LogOut, Plus, Users as UsersIcon } from 'lucide-react'
import { api, setToken } from './api/client'
import Login from './pages/Login'
import MyTasks from './pages/MyTasks'
import Dashboard from './pages/Dashboard'
import Reports from './pages/Reports'
import Users from './pages/Users'
import Departments from './pages/Departments'
import DelayReasons from './pages/DelayReasons'
import TaskForm from './pages/TaskForm'
import TaskDetails from './pages/TaskDetails'

export default function App() {
  const [user, setUser] = useState(null)
  const [route, setRoute] = useState('loading')
  const [selectedTask, setSelectedTask] = useState(null)

  useEffect(() => {
    api('/auth/me')
      .then((me) => {
        setUser(me)
        setRoute(defaultRoute(me.role))
      })
      .catch(() => setRoute('login'))
  }, [])

  function defaultRoute(role) {
    if (role === 'employee') return 'my-tasks'
    if (role === 'manager') return 'dashboard'
    return 'admin-dashboard'
  }

  function logout() {
    setToken(null)
    setUser(null)
    setRoute('login')
  }

  function openTask(id) {
    setSelectedTask(id)
    setRoute('task-details')
  }

  if (route === 'loading') return <div className="empty">جار التحميل...</div>
  if (route === 'login') return <Login onLogin={(me) => { setUser(me); setRoute(defaultRoute(me.role)) }} />

  const nav = buildNav(user.role)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <ClipboardList />
          <div><strong>لوحة المهام</strong><span>Team Tasks Manager</span></div>
        </div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.route}
              className={route === item.route ? 'active' : ''}
              onClick={() => {
                if (item.route === 'task-form') setSelectedTask(null)
                setRoute(item.route)
              }}
            >
              <item.icon size={18} />{item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div><strong>{user.full_name_ar}</strong><span>{user.role}</span></div>
          <button className="icon-button" onClick={logout} title="تسجيل الخروج"><LogOut size={18} /></button>
        </header>
        {route === 'my-tasks' && <MyTasks openTask={openTask} />}
        {(route === 'dashboard' || route === 'admin-dashboard') && <Dashboard user={user} openTask={openTask} createTask={() => { setSelectedTask(null); setRoute('task-form') }} />}
        {route === 'task-form' && <TaskForm taskId={selectedTask} onSaved={() => setRoute(defaultRoute(user.role))} />}
        {route === 'task-details' && <TaskDetails taskId={selectedTask} user={user} editTask={(id) => { setSelectedTask(id); setRoute('task-form') }} onDeleted={() => setRoute(defaultRoute(user.role))} />}
        {route === 'reports' && <Reports />}
        {route === 'users' && <Users />}
        {route === 'departments' && <Departments />}
        {route === 'delay-reasons' && <DelayReasons />}
      </main>
    </div>
  )
}

function buildNav(role) {
  if (role === 'employee') {
    return [
      { route: 'my-tasks', label: 'مهامي', icon: ClipboardList },
      { route: 'reports', label: 'تقريري الأسبوعي', icon: BarChart3 },
    ]
  }
  if (role === 'manager') {
    return [
      { route: 'dashboard', label: 'لوحة القسم', icon: ClipboardList },
      { route: 'task-form', label: 'إنشاء مهمة', icon: Plus },
      { route: 'reports', label: 'التقارير', icon: BarChart3 },
    ]
  }
  return [
    { route: 'admin-dashboard', label: 'لوحة الإدارة', icon: ClipboardList },
    { route: 'task-form', label: 'إنشاء مهمة', icon: Plus },
    { route: 'reports', label: 'التقارير', icon: BarChart3 },
    { route: 'users', label: 'المستخدمون', icon: UsersIcon },
    { route: 'departments', label: 'الأقسام', icon: Building2 },
    { route: 'delay-reasons', label: 'أسباب التأخير', icon: BarChart3 },
  ]
}
