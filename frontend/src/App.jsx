import { useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, Building2, CalendarDays, ClipboardList, LogOut, Palette, Plus, Users as UsersIcon, X } from 'lucide-react'
import { api, setToken } from './api/client'
import { priorityLabels, roleLabels, statusLabels } from './utils/labels'
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
  const [theme, setTheme] = useState(() => localStorage.getItem('team_tasks_theme') || 'light')
  const [briefing, setBriefing] = useState(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('team_tasks_theme', theme)
  }, [theme])

  useEffect(() => {
    api('/auth/me')
      .then((me) => {
        setUser(me)
        setTheme(me.theme_id || localStorage.getItem('team_tasks_theme') || 'light')
        setRoute(defaultRoute(me.role))
      })
      .catch(() => setRoute('login'))
  }, [])

  useEffect(() => {
    if (!user) return
    const briefingKey = `team_tasks_briefing_${user.id}`
    if (sessionStorage.getItem(briefingKey)) return

    const loadBriefing = () => {
      api(`/tasks?assigned_to=${user.id}`)
        .then((tasks) => {
          const activeTasks = tasks.filter((task) => !['done', 'cancelled'].includes(task.status))
          if (activeTasks.length) {
            setBriefing({
              tasks: rankUrgentTasks(activeTasks).slice(0, 4),
              total: activeTasks.length,
              overdue: activeTasks.filter(isOverdue).length,
            })
          }
          sessionStorage.setItem(briefingKey, 'shown')
        })
        .catch(() => {})
    }
    const timer = window.setTimeout(loadBriefing, 500)
    return () => window.clearTimeout(timer)
  }, [user])

  function defaultRoute(role) {
    if (role === 'employee') return 'my-tasks'
    if (role === 'manager') return 'dashboard'
    return 'admin-dashboard'
  }

  function logout() {
    if (user) sessionStorage.removeItem(`team_tasks_briefing_${user.id}`)
    setToken(null)
    setUser(null)
    setBriefing(null)
    setRoute('login')
  }

  function openTask(id) {
    setSelectedTask(id)
    setRoute('task-details')
  }

  function saveTheme(nextTheme, activeUser = user) {
    setTheme(nextTheme)
    if (!activeUser) return
    api('/users/me/theme', {
      method: 'PATCH',
      body: JSON.stringify({ theme_id: nextTheme }),
    })
      .then((updatedUser) => setUser(updatedUser))
      .catch(() => {})
  }

  if (route === 'loading') return <div className="empty">جار التحميل...</div>
  if (route === 'login') {
    return (
      <>
        <ThemePicker theme={theme} onThemeChange={(nextTheme) => saveTheme(nextTheme)} className="login-theme-toggle" />
        <Login onLogin={(me) => { setUser(me); setTheme(me.theme_id || theme); setRoute(defaultRoute(me.role)) }} />
      </>
    )
  }

  const nav = buildNav(user.role)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><ClipboardList size={18} /></span>
          <div><strong>لوحة المهام</strong><span>إدارة مهام الفريق</span></div>
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
        <div className="sidebar-user">
          <span className="avatar">{initials(user.full_name_ar)}</span>
          <div><strong>{user.full_name_ar}</strong><span>{roleLabels[user.role]}</span></div>
          <button className="icon-button" onClick={logout} title="تسجيل الخروج"><LogOut size={17} /></button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div><strong>{routeTitle(route)}</strong><span>مرحباً، {user.full_name_ar}</span></div>
          <div className="topbar-actions">
            <ThemePicker theme={theme} onThemeChange={(nextTheme) => saveTheme(nextTheme, user)} />
            <span className="topbar-avatar avatar">{initials(user.full_name_ar)}</span>
          </div>
        </header>
        <div className="page-content">
          {route === 'my-tasks' && <MyTasks user={user} openTask={openTask} />}
          {(route === 'dashboard' || route === 'admin-dashboard') && <Dashboard user={user} openTask={openTask} createTask={() => { setSelectedTask(null); setRoute('task-form') }} />}
          {route === 'task-form' && <TaskForm taskId={selectedTask} onSaved={() => setRoute(defaultRoute(user.role))} />}
          {route === 'task-details' && <TaskDetails taskId={selectedTask} user={user} editTask={(id) => { setSelectedTask(id); setRoute('task-form') }} onDeleted={() => setRoute(defaultRoute(user.role))} />}
          {route === 'reports' && <Reports />}
          {route === 'users' && <Users />}
          {route === 'departments' && <Departments />}
          {route === 'delay-reasons' && <DelayReasons />}
        </div>
      </main>
      {briefing && (
        <TaskBriefing
          briefing={briefing}
          user={user}
          onClose={() => setBriefing(null)}
          onOpen={(id) => {
            setBriefing(null)
            openTask(id)
          }}
        />
      )}
    </div>
  )
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('\u00a0')
}

function routeTitle(route) {
  const titles = {
    'my-tasks': 'مهامي',
    dashboard: 'لوحة القسم',
    'admin-dashboard': 'لوحة الإدارة',
    'task-form': 'إدارة المهمة',
    'task-details': 'تفاصيل المهمة',
    reports: 'التقارير',
    users: 'المستخدمون',
    departments: 'الأقسام',
    'delay-reasons': 'أسباب التأخير',
  }
  return titles[route] || 'لوحة المهام'
}

function TaskBriefing({ briefing, user, onClose, onOpen }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="briefing-modal" role="dialog" aria-modal="true" aria-labelledby="briefing-title" onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head">
          <div>
            <p className="eyebrow">مرحباً {user.full_name_ar}</p>
            <h2 id="briefing-title">ملخص المهام العاجلة</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="إغلاق" aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="briefing-summary">
          <span>لديك <strong>{briefing.total}</strong> مهمة نشطة</span>
          {briefing.overdue > 0 && <span className="briefing-overdue"><AlertTriangle size={16} /> متأخر في <strong>{briefing.overdue}</strong> مهمة</span>}
        </div>

        <div className="briefing-list">
          {briefing.tasks.map((task) => (
            <button className="briefing-task" key={task.id} onClick={() => onOpen(task.id)}>
              <div>
                <strong>{task.title}</strong>
                <span>{statusLabels[task.status]} · {priorityLabels[task.priority]}</span>
              </div>
              <DueMessage task={task} />
            </button>
          ))}
        </div>

        <footer className="briefing-actions">
          <button className="primary" onClick={onClose}>عرض لوحة المهام</button>
        </footer>
      </section>
    </div>
  )
}

function DueMessage({ task }) {
  const days = daysFromToday(task.due_date)
  if (days < 0) return <span className="due-message overdue"><AlertTriangle size={15} /> متأخرة منذ {Math.abs(days)} يوم</span>
  if (days === 0) return <span className="due-message today"><CalendarDays size={15} /> موعدها اليوم</span>
  if (days === 1) return <span className="due-message"><CalendarDays size={15} /> موعدها غداً</span>
  return <span className="due-message"><CalendarDays size={15} /> متبقي {days} أيام</span>
}

function rankUrgentTasks(tasks) {
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 }
  return [...tasks].sort((a, b) => {
    const aDays = daysFromToday(a.due_date)
    const bDays = daysFromToday(b.due_date)
    if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority]
    return aDays - bDays
  })
}

function isOverdue(task) {
  return daysFromToday(task.due_date) < 0
}

function daysFromToday(dueDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(`${dueDate}T00:00:00`)
  return Math.round((due - today) / 86400000)
}

function ThemePicker({ theme, onThemeChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const activeTheme = themeOptions.find((option) => option.id === theme) || themeOptions[0]
  return (
    <div className={`theme-picker ${className}`}>
      <button
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        title="اختيار الثيم"
        aria-label="اختيار الثيم"
        type="button"
      >
        <Palette size={18} />
      </button>
      {open && (
        <div className="theme-menu" role="menu">
          <strong>الثيم</strong>
          <div>
            {themeOptions.map((option) => (
              <button
                key={option.id}
                className={activeTheme.id === option.id ? 'active' : ''}
                onClick={() => {
                  onThemeChange(option.id)
                  setOpen(false)
                }}
                type="button"
                title={option.label}
              >
                <span style={{ background: option.color }} />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const themeOptions = [
  { id: 'light', label: 'فاتح', color: '#2563eb' },
  { id: 'dark', label: 'ليلي', color: '#0f172a' },
  { id: 'blue', label: 'أزرق', color: '#0ea5e9' },
  { id: 'green', label: 'أخضر', color: '#16a34a' },
  { id: 'orange', label: 'برتقالي', color: '#f97316' },
]

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
