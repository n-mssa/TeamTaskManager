import { useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, Bell, Building2, Check, Clock, ClipboardList, LogOut, Palette, Plus, Users as UsersIcon, X } from 'lucide-react'
import { api, setToken } from './api/client'
import { priorityLabels, roleLabels, statusLabels } from './utils/labels'
import Login from './pages/Login'
import MyTasks from './pages/MyTasks'
import Dashboard from './pages/Dashboard'
import Reports from './pages/Reports'
import Kpi from './pages/Kpi'
import Users from './pages/Users'
import Departments from './pages/Departments'
import DelayReasons from './pages/DelayReasons'
import TaskForm from './pages/TaskForm'
import TaskDetails from './pages/TaskDetails'
import { formatDuration, isOverExpected, remainingExpectedSeconds } from './utils/tasks'

export default function App() {
  const [user, setUser] = useState(null)
  const [route, setRoute] = useState('loading')
  const [selectedTask, setSelectedTask] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('team_tasks_theme') || 'light')
  const [briefing, setBriefing] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() => getBrowserNotificationPermission())
  const [endOfDayPrompt, setEndOfDayPrompt] = useState(null)
  const [expectedTimeReview, setExpectedTimeReview] = useState(null)

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

  useEffect(() => {
    if (!user) return
    const seenKey = `team_tasks_seen_notifications_${user.id}`
    const seen = new Set(JSON.parse(sessionStorage.getItem(seenKey) || '[]'))

    const loadNotifications = () => {
      api('/notifications?unread_only=true&limit=20')
        .then((items) => {
          setNotifications(items)
          const fresh = items.find((item) => !seen.has(item.id))
          if (fresh) {
            seen.add(fresh.id)
            sessionStorage.setItem(seenKey, JSON.stringify([...seen].slice(-100)))
            setToast(fresh)
            if (document.hidden) showBrowserNotification(fresh)
            window.setTimeout(() => setToast((current) => current?.id === fresh.id ? null : current), 6000)
          }
        })
        .catch(() => {})
    }

    loadNotifications()
    const interval = window.setInterval(loadNotifications, 45_000)
    return () => window.clearInterval(interval)
  }, [user, browserNotificationPermission])

  useEffect(() => {
    if (!user) return
    const todayKey = localDateKey()
    const storageKey = `team_tasks_end_of_day_prompt_${user.id}_${todayKey}`

    const checkEndOfDay = () => {
      const now = new Date()
      const isAfterPromptTime = now.getHours() > 16 || (now.getHours() === 16 && now.getMinutes() >= 55)
      if (!isAfterPromptTime || localStorage.getItem(storageKey) || endOfDayPrompt) return
      localStorage.setItem(storageKey, 'checked')
      api(`/tasks?assigned_to=${user.id}&status=in_progress`)
        .then((tasks) => {
          const activeTasks = tasks.filter((task) => task.assigned_to_user_id === user.id && task.status === 'in_progress')
          if (activeTasks.length) {
            setEndOfDayPrompt({ tasks: activeTasks })
            if (document.hidden) showEndOfDayBrowserNotification(activeTasks.length)
          }
        })
        .catch(() => {})
    }

    checkEndOfDay()
    const interval = window.setInterval(checkEndOfDay, 60_000)
    return () => window.clearInterval(interval)
  }, [user, endOfDayPrompt])

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
    setNotifications([])
    setNotificationsOpen(false)
    setToast(null)
    setEndOfDayPrompt(null)
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

  async function markNotificationRead(notification) {
    await api(`/notifications/${notification.id}/read`, { method: 'PATCH' })
    setNotifications((current) => current.filter((item) => item.id !== notification.id))
  }

  async function markAllNotificationsRead() {
    if (!notifications.length) return
    await api('/notifications/read-all', { method: 'PATCH' })
    setNotifications([])
    setNotificationsOpen(false)
  }

  async function openNotification(notification) {
    if (notification.notification_type === 'expected_time_complaint' && notification.task_id) {
      try {
        const task = await api(`/tasks/${notification.task_id}`)
        setExpectedTimeReview({
          notification,
          task,
          adjustedMinutes: Math.max(task.expected_minutes || 1, Math.ceil((task.elapsed_seconds || 0) / 60)),
          saving: false,
          error: '',
        })
        setNotificationsOpen(false)
        setToast(null)
      } catch (err) {
        await markNotificationRead(notification)
        openTask(notification.task_id)
        setNotificationsOpen(false)
        setToast(null)
      }
      return
    }
    await markNotificationRead(notification)
    if (notification.task_id) openTask(notification.task_id)
    setNotificationsOpen(false)
    setToast(null)
  }

  async function acceptExpectedTimeReview() {
    if (!expectedTimeReview) return
    const adjustedMinutes = Number(expectedTimeReview.adjustedMinutes)
    if (!Number.isFinite(adjustedMinutes) || adjustedMinutes < 1) {
      setExpectedTimeReview((current) => current ? { ...current, error: 'يرجى إدخال وقت متوقع صحيح.' } : current)
      return
    }
    setExpectedTimeReview((current) => current ? { ...current, saving: true, error: '' } : current)
    try {
      await api(`/tasks/${expectedTimeReview.task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ expected_minutes: Math.round(adjustedMinutes) }),
      })
      await markNotificationRead(expectedTimeReview.notification)
      window.dispatchEvent(new CustomEvent('team-tasks-refresh'))
      setExpectedTimeReview(null)
    } catch (err) {
      setExpectedTimeReview((current) => current ? { ...current, saving: false, error: err.message } : current)
    }
  }

  async function denyExpectedTimeReview() {
    if (!expectedTimeReview) return
    await markNotificationRead(expectedTimeReview.notification)
    setExpectedTimeReview(null)
  }

  async function openExpectedTimeReviewDetails() {
    if (!expectedTimeReview) return
    const { notification, task } = expectedTimeReview
    await markNotificationRead(notification)
    setExpectedTimeReview(null)
    openTask(task.id)
  }

  async function enableBrowserNotifications() {
    if (!('Notification' in window)) {
      setBrowserNotificationPermission('unsupported')
      return
    }
    const permission = await window.Notification.requestPermission()
    setBrowserNotificationPermission(permission)
  }

  function showBrowserNotification(notification) {
    if (!('Notification' in window) || window.Notification.permission !== 'granted') return
    const browserNotification = new window.Notification(notification.title, {
      body: notification.message,
      tag: `team-task-${notification.id}`,
    })
    browserNotification.onclick = () => {
      window.focus()
      openNotification(notification)
      browserNotification.close()
    }
  }

  function showEndOfDayBrowserNotification(taskCount) {
    if (!('Notification' in window) || window.Notification.permission !== 'granted') return
    const browserNotification = new window.Notification('اليوم أوشك على الانتهاء', {
      body: `لديك ${taskCount} مهمة قيد التنفيذ. افتح التطبيق لاختيار نقلها إلى متوقف.`,
      tag: `team-task-end-of-day-${localDateKey()}`,
    })
    browserNotification.onclick = () => {
      window.focus()
      browserNotification.close()
    }
  }

  async function pauseEndOfDayTasks() {
    if (!endOfDayPrompt?.tasks?.length) return
    const reason = 'END OF DAY'
    await Promise.all(endOfDayPrompt.tasks.map((task) => api(`/tasks/${task.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'blocked',
        hold_reason_text: reason,
        overrun_reason_text: task.overrun_reason_text || reason,
      }),
    })))
    window.dispatchEvent(new CustomEvent('team-tasks-refresh'))
    setEndOfDayPrompt(null)
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
            <NotificationBell
              notifications={notifications}
              open={notificationsOpen}
              onToggle={() => setNotificationsOpen((value) => !value)}
              onOpenNotification={openNotification}
              onMarkRead={markNotificationRead}
              onMarkAllRead={markAllNotificationsRead}
              browserPermission={browserNotificationPermission}
              onEnableBrowserNotifications={enableBrowserNotifications}
            />
            <ThemePicker theme={theme} onThemeChange={(nextTheme) => saveTheme(nextTheme, user)} />
            <span className="topbar-avatar avatar">{initials(user.full_name_ar)}</span>
          </div>
        </header>
        <div className="page-content">
          {route === 'my-tasks' && <MyTasks user={user} openTask={openTask} />}
          {(route === 'dashboard' || route === 'admin-dashboard') && <Dashboard user={user} openTask={openTask} createTask={() => { setSelectedTask(null); setRoute('task-form') }} />}
          {route === 'task-form' && <TaskForm taskId={selectedTask} user={user} onSaved={() => setRoute(defaultRoute(user.role))} />}
          {route === 'task-details' && <TaskDetails taskId={selectedTask} user={user} editTask={(id) => { setSelectedTask(id); setRoute('task-form') }} onDeleted={() => setRoute(defaultRoute(user.role))} />}
          {route === 'reports' && <Reports user={user} openTask={openTask} />}
          {route === 'kpi' && <Kpi user={user} />}
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
      {toast && <NotificationToast notification={toast} onOpen={() => openNotification(toast)} onClose={() => setToast(null)} />}
      {endOfDayPrompt && (
        <EndOfDayPrompt
          taskCount={endOfDayPrompt.tasks.length}
          onConfirm={pauseEndOfDayTasks}
          onDismiss={() => setEndOfDayPrompt(null)}
        />
      )}
      {expectedTimeReview && (
        <ExpectedTimeReviewModal
          review={expectedTimeReview}
          onChangeMinutes={(value) => setExpectedTimeReview((current) => current ? { ...current, adjustedMinutes: value, error: '' } : current)}
          onAccept={acceptExpectedTimeReview}
          onDeny={denyExpectedTimeReview}
          onDetails={openExpectedTimeReviewDetails}
          onClose={() => setExpectedTimeReview(null)}
        />
      )}
    </div>
  )
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('\u00a0')
}

function NotificationBell({
  notifications,
  open,
  onToggle,
  onOpenNotification,
  onMarkRead,
  onMarkAllRead,
  browserPermission,
  onEnableBrowserNotifications,
}) {
  return (
    <div className="notification-center">
      <button className="icon-button notification-trigger" onClick={onToggle} title="الإشعارات" aria-label="الإشعارات" type="button">
        <Bell size={18} />
        {notifications.length > 0 && <span className="notification-count">{notifications.length}</span>}
      </button>
      {open && (
        <div className="notification-menu">
          <header>
            <strong>الإشعارات</strong>
            {notifications.length > 0 && <button type="button" onClick={onMarkAllRead}>تحديد الكل كمقروء</button>}
          </header>
          <BrowserNotificationPrompt permission={browserPermission} onEnable={onEnableBrowserNotifications} />
          {notifications.length ? (
            <div className="notification-list">
              {notifications.map((notification) => (
                <article key={notification.id} className="notification-item">
                  <button type="button" onClick={() => onOpenNotification(notification)}>
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <small>{formatNotificationTime(notification.created_at)}</small>
                  </button>
                  <button className="icon-button" type="button" onClick={() => onMarkRead(notification)} title="تحديد كمقروء" aria-label="تحديد كمقروء">
                    <Check size={16} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="notification-empty">لا توجد إشعارات جديدة.</p>
          )}
        </div>
      )}
    </div>
  )
}

function EndOfDayPrompt({ taskCount, onConfirm, onDismiss }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onDismiss}>
      <section className="briefing-modal end-of-day-modal" role="dialog" aria-modal="true" aria-labelledby="end-of-day-title" onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head">
          <div>
            <p className="eyebrow">4:55 PM</p>
            <h2 id="end-of-day-title">اليوم أوشك على الانتهاء</h2>
          </div>
          <button className="icon-button" onClick={onDismiss} title="إغلاق" aria-label="إغلاق"><X size={18} /></button>
        </header>
        <p className="end-of-day-copy">
          لديك {taskCount} مهمة قيد التنفيذ. هل تريد نقلها كلها إلى قائمة متوقف مع سبب: <strong>END OF DAY</strong>؟
        </p>
        <footer className="briefing-actions">
          <button type="button" onClick={onDismiss}>لا، اتركها كما هي</button>
          <button className="primary" type="button" onClick={onConfirm}>نعم، انقلها</button>
        </footer>
      </section>
    </div>
  )
}

function ExpectedTimeReviewModal({ review, onChangeMinutes, onAccept, onDeny, onDetails, onClose }) {
  const { task, adjustedMinutes, saving, error } = review
  const actualMinutes = Math.ceil((task.elapsed_seconds || 0) / 60)
  const overBySeconds = Math.max((task.elapsed_seconds || 0) - ((task.expected_minutes || 0) * 60), 0)

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="briefing-modal expected-time-review-modal" role="dialog" aria-modal="true" aria-labelledby="expected-time-review-title" onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head">
          <div>
            <p className="eyebrow">اعتراض على الوقت المتوقع</p>
            <h2 id="expected-time-review-title">مراجعة وقت المهمة</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="إغلاق" aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="expected-review-body">
          <div>
            <span>المهمة</span>
            <strong>{task.title}</strong>
          </div>
          <div>
            <span>المكلف</span>
            <strong>{task.assignee?.full_name_ar || 'غير محدد'}</strong>
          </div>
          <div>
            <span>الوقت المتوقع الحالي</span>
            <strong>{formatMinutes(task.expected_minutes || 0)}</strong>
          </div>
          <div>
            <span>الوقت الفعلي</span>
            <strong>{formatDuration(task.elapsed_seconds || 0)}</strong>
          </div>
          <div>
            <span>مدة التجاوز</span>
            <strong>{overBySeconds ? formatDuration(overBySeconds) : 'لا يوجد'}</strong>
          </div>
        </div>

        <article className="expected-review-reason">
          <span>سبب الموظف</span>
          <p>{task.expected_time_complaint_text || 'لا يوجد سبب مكتوب.'}</p>
        </article>

        <label className="expected-review-input">تعديل الوقت المتوقع بالدقائق
          <input
            type="number"
            min="1"
            value={adjustedMinutes}
            onChange={(event) => onChangeMinutes(event.target.value)}
          />
          <small>اقتراح تلقائي حسب الوقت الفعلي: {actualMinutes} دقيقة</small>
        </label>

        {error && <p className="error">{error}</p>}
        <footer className="briefing-actions">
          <button type="button" onClick={onDetails} disabled={saving}>عرض التفاصيل</button>
          <button type="button" onClick={onDeny} disabled={saving}>رفض الاعتراض</button>
          <button className="primary" type="button" onClick={onAccept} disabled={saving}>{saving ? 'جاري الحفظ...' : 'قبول وتعديل الوقت'}</button>
        </footer>
      </section>
    </div>
  )
}

function BrowserNotificationPrompt({ permission, onEnable }) {
  if (permission === 'granted' || permission === 'unsupported') return null
  if (permission === 'denied') {
    return <p className="browser-notification-note">تنبيهات المتصفح محظورة من إعدادات المتصفح.</p>
  }
  return (
    <button className="browser-notification-enable" type="button" onClick={onEnable}>
      تفعيل تنبيهات المتصفح عند الخروج من التبويب
    </button>
  )
}

function NotificationToast({ notification, onOpen, onClose }) {
  return (
    <div className="notification-toast" role="status">
      <button type="button" onClick={onOpen}>
        <strong>{notification.title}</strong>
        <span>{notification.message}</span>
      </button>
      <button className="icon-button" type="button" onClick={onClose} title="إغلاق" aria-label="إغلاق"><X size={16} /></button>
    </div>
  )
}

function formatNotificationTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ar-JO', { dateStyle: 'short', timeStyle: 'short' })
}

function formatMinutes(minutes) {
  const totalMinutes = Math.max(0, Number(minutes) || 0)
  const hours = Math.floor(totalMinutes / 60)
  const rest = totalMinutes % 60
  if (hours && rest) return `${hours}س ${rest}د`
  if (hours) return `${hours}س`
  return `${rest}د`
}

function getBrowserNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

function localDateKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function routeTitle(route) {
  const titles = {
    'my-tasks': 'مهامي',
    dashboard: 'لوحة القسم',
    'admin-dashboard': 'لوحة الإدارة',
    'task-form': 'إدارة المهمة',
    'task-details': 'تفاصيل المهمة',
    reports: 'التقارير',
    kpi: 'مؤشرات الأداء (KPI)',
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
  const remaining = remainingExpectedSeconds(task)
  if (remaining < 0) return <span className="due-message overdue"><AlertTriangle size={15} /> تجاوزت المتوقع بـ {formatDuration(Math.abs(remaining))}</span>
  return <span className="due-message"><Clock size={15} /> متبقي {formatDuration(remaining)}</span>
}

function rankUrgentTasks(tasks) {
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 }
  return [...tasks].sort((a, b) => {
    const aRemaining = remainingExpectedSeconds(a)
    const bRemaining = remainingExpectedSeconds(b)
    if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority]
    return aRemaining - bRemaining
  })
}

function isOverdue(task) {
  return isOverExpected(task)
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
      { route: 'kpi', label: 'مؤشرات الأداء (KPI)', icon: BarChart3 },
    ]
  }
  return [
    { route: 'admin-dashboard', label: 'لوحة الإدارة', icon: ClipboardList },
    { route: 'task-form', label: 'إنشاء مهمة', icon: Plus },
    { route: 'reports', label: 'التقارير', icon: BarChart3 },
    { route: 'kpi', label: 'مؤشرات الأداء (KPI)', icon: BarChart3 },
    { route: 'users', label: 'المستخدمون', icon: UsersIcon },
    { route: 'departments', label: 'الأقسام', icon: Building2 },
    { route: 'delay-reasons', label: 'أسباب التأخير', icon: BarChart3 },
  ]
}
