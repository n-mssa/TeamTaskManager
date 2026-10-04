import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, Bell, BellRing, Building2, Check, Clock, ClipboardList, LogOut, Palette, Plus, Send, Users as UsersIcon, X } from 'lucide-react'
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
import BillsImport from './pages/BillsImport'
import { formatDuration, isOverExpected, remainingExpectedSeconds } from './utils/tasks'

export default function App() {
  const [user, setUser] = useState(null)
  const [route, setRoute] = useState('loading')
  const [selectedTask, setSelectedTask] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('team_tasks_theme') || 'light')
  const [briefing, setBriefing] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [billsTodos, setBillsTodos] = useState([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() => getBrowserNotificationPermission())
  const [autoPausePrompt, setAutoPausePrompt] = useState(null)
  const [expectedTimeReview, setExpectedTimeReview] = useState(null)
  const [billsMessageConfig, setBillsMessageConfig] = useState(null)
  const [billsMessageOpen, setBillsMessageOpen] = useState(false)
  const historyReady = useRef(false)
  const handlingHistoryPop = useRef(false)
  const pendingScrollRestore = useRef(null)

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
    const handlePopState = (event) => {
      const state = event.state
      if (!state?.teamTasksRoute) return
      handlingHistoryPop.current = true
      pendingScrollRestore.current = typeof state.scrollY === 'number' ? state.scrollY : null
      setSelectedTask(state.selectedTask || null)
      setRoute(state.route)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (route === 'loading') return
    const state = { teamTasksRoute: true, route, selectedTask }
    const hash = selectedTask ? `#${route}/${selectedTask}` : `#${route}`
    if (!historyReady.current) {
      window.history.replaceState(state, '', hash)
      historyReady.current = true
      return
    }
    if (handlingHistoryPop.current) {
      handlingHistoryPop.current = false
      return
    }
    const currentState = window.history.state
    if (currentState?.teamTasksRoute && currentState.route === route && currentState.selectedTask === selectedTask) return
    window.history.pushState(state, '', hash)
  }, [route, selectedTask])

  useEffect(() => {
    if (pendingScrollRestore.current === null || route === 'task-details') return
    const targetY = pendingScrollRestore.current
    const delays = [0, 50, 150, 300, 600, 1000]
    const timers = delays.map((delay, index) => window.setTimeout(() => {
      window.scrollTo({ top: targetY, behavior: 'auto' })
      if (index === delays.length - 1) pendingScrollRestore.current = null
    }, delay))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [route, selectedTask])

  useEffect(() => {
    if (!user || user.role === 'bills_user') return
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
            if (fresh.notification_type === 'sanad_attached') {
              window.dispatchEvent(new CustomEvent('team-tasks-refresh'))
            }
            seen.add(fresh.id)
            sessionStorage.setItem(seenKey, JSON.stringify([...seen].slice(-100)))
            setToast(fresh)
            if (document.hidden) showBrowserNotification(fresh)
            window.setTimeout(() => setToast((current) => current?.id === fresh.id ? null : current), 6000)
          }
        })
        .catch(() => {})
      if (user.role === 'bills_user') {
        api('/notifications/bills-todos')
          .then(setBillsTodos)
          .catch(() => {})
      }
    }

    loadNotifications()
    const interval = window.setInterval(loadNotifications, user.role === 'bills_user' ? 15_000 : 45_000)
    return () => window.clearInterval(interval)
  }, [user, browserNotificationPermission])

  useEffect(() => {
    if (!user || user.role === 'bills_user') {
      setBillsMessageConfig(null)
      return
    }
    api('/notifications/bills-message/config')
      .then(setBillsMessageConfig)
      .catch(() => setBillsMessageConfig(null))
  }, [user])

  useEffect(() => {
    if (!user || user.role === 'bills_user') return

    const checkAutoPauseWindows = () => {
      const now = new Date()
      const activeWindow = autoPauseWindows.find((item) => isInsideWindow(now, item.start, item.cancelUntil))
      if (!activeWindow || autoPausePrompt) return
      const storageKey = `team_tasks_auto_pause_${user.id}_${localDateKey()}_${activeWindow.id}`
      if (localStorage.getItem(storageKey)) return
      const pausedAt = new Date().toISOString()
      api('/tasks/auto-pause', {
        method: 'POST',
        body: JSON.stringify({
          reason: activeWindow.reason,
          overrun_reason_text: activeWindow.reason,
        }),
      })
        .then(async (tasks) => {
          const pausedTasks = Array.isArray(tasks) ? tasks : []
          const ownPausedTasks = pausedTasks.filter((task) => task.assigned_to_user_id === user.id && task.status === 'blocked')
          const ownAlreadyPausedTasks = ownPausedTasks.length
            ? []
            : await api(`/tasks?assigned_to=${user.id}&status=blocked`)
              .then((items) => items.filter((task) => task.assigned_to_user_id === user.id && task.hold_reason_text === activeWindow.reason))
              .catch(() => [])
          const activeTasks = [...ownPausedTasks, ...ownAlreadyPausedTasks].filter((task, index, items) => (
            items.findIndex((item) => item.id === task.id) === index
          ))
          localStorage.setItem(storageKey, 'checked')
          window.dispatchEvent(new CustomEvent('team-tasks-refresh'))
          if (!activeTasks.length) return
          setAutoPausePrompt({ window: activeWindow, tasks: activeTasks, pausedAt: ownPausedTasks.length ? pausedAt : null })
          if (document.hidden) showAutoPauseBrowserNotification(activeWindow, activeTasks.length)
        })
        .catch(() => {})
    }

    checkAutoPauseWindows()
    const interval = window.setInterval(checkAutoPauseWindows, 30_000)
    return () => window.clearInterval(interval)
  }, [user, autoPausePrompt])

  function defaultRoute(role) {
    if (role === 'bills_user') return 'bills-import'
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
    setBillsTodos([])
    setNotificationsOpen(false)
    setBillsMessageConfig(null)
    setBillsMessageOpen(false)
    setToast(null)
    setAutoPausePrompt(null)
    setExpectedTimeReview(null)
    historyReady.current = false
    handlingHistoryPop.current = false
    setRoute('login')
  }

  function openTask(id) {
    const currentState = window.history.state
    if (currentState?.teamTasksRoute) {
      window.history.replaceState({ ...currentState, scrollY: window.scrollY }, '', window.location.href)
    }
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
    setBillsTodos((current) => current.filter((item) => item.id !== notification.id))
  }

  async function markAllNotificationsRead() {
    if (!notifications.length) return
    await api('/notifications/read-all', { method: 'PATCH' })
    setNotifications([])
    setNotificationsOpen(false)
  }

  async function openNotification(notification) {
    if (notification.notification_type === 'finance_message') {
      setNotificationsOpen(false)
      setToast(null)
      return
    }
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
      await api(`/tasks/${expectedTimeReview.task.id}/expected-time-review`, {
        method: 'PATCH',
        body: JSON.stringify({ approved: true, expected_minutes: Math.round(adjustedMinutes) }),
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
    setExpectedTimeReview((current) => current ? { ...current, saving: true, error: '' } : current)
    try {
      await api(`/tasks/${expectedTimeReview.task.id}/expected-time-review`, {
        method: 'PATCH',
        body: JSON.stringify({ approved: false }),
      })
      await markNotificationRead(expectedTimeReview.notification)
      window.dispatchEvent(new CustomEvent('team-tasks-refresh'))
      setExpectedTimeReview(null)
    } catch (err) {
      setExpectedTimeReview((current) => current ? { ...current, saving: false, error: err.message } : current)
    }
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

  function showAutoPauseBrowserNotification(windowConfig, taskCount) {
    if (!('Notification' in window) || window.Notification.permission !== 'granted') return
    const browserNotification = new window.Notification(windowConfig.title, {
      body: `تم نقل ${taskCount} مهمة إلى متوقف. افتح التطبيق لإلغاء الإيقاف إذا كنت ما زلت تعمل.`,
      tag: `team-task-auto-pause-${windowConfig.id}-${localDateKey()}`,
    })
    browserNotification.onclick = () => {
      window.focus()
      browserNotification.close()
    }
  }

  async function cancelAutoPause() {
    if (!autoPausePrompt?.tasks?.length) return
    if (!isInsideWindow(new Date(), autoPausePrompt.window.start, autoPausePrompt.window.cancelUntil)) {
      setAutoPausePrompt(null)
      return
    }
    await Promise.all(autoPausePrompt.tasks.map((task) => api(`/tasks/${task.id}/auto-pause-cancel`, {
      method: 'POST',
      body: JSON.stringify({ paused_at: autoPausePrompt.pausedAt }),
    })))
    window.dispatchEvent(new CustomEvent('team-tasks-refresh'))
    setAutoPausePrompt(null)
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

  if (user.role === 'bills_user') {
    return (
      <div className="bills-workspace">
        <header className="bills-workspace-header">
          <div><span className="brand-mark"><ClipboardList size={18} /></span><div><strong>إدخال مهام المالية</strong><span>مرحباً، {user.full_name_ar}</span></div></div>
          <div className="topbar-actions">
            <NotificationBell
              notifications={notifications}
              open={notificationsOpen}
              onToggle={() => setNotificationsOpen((value) => !value)}
              onOpenNotification={openNotification}
              onMarkRead={markNotificationRead}
              onMarkAllRead={markAllNotificationsRead}
              allowMarkAll={false}
              browserPermission={browserNotificationPermission}
              onEnableBrowserNotifications={enableBrowserNotifications}
            />
            <ThemePicker theme={theme} onThemeChange={(nextTheme) => saveTheme(nextTheme, user)} />
            <button className="icon-button" onClick={logout} title="تسجيل الخروج"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="bills-workspace-main">
          <div className="bills-workspace-layout">
            <BillsTodoColumn
              todos={billsTodos}
              onComplete={markNotificationRead}
            />
            <BillsImport />
          </div>
        </main>
        {toast && <NotificationToast notification={toast} onOpen={() => openNotification(toast)} onClose={() => setToast(null)} />}
      </div>
    )
  }

  const nav = buildNav(user)

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
            {billsMessageConfig?.can_send && (
              <button className="icon-button bills-message-trigger" onClick={() => setBillsMessageOpen(true)} title="إرسال تنبيه لمستخدم الفواتير" aria-label="إرسال تنبيه لمستخدم الفواتير" type="button">
                <BellRing size={18} />
              </button>
            )}
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
          {route === 'task-form' && <TaskForm taskId={selectedTask} user={user} onSaved={() => { window.dispatchEvent(new CustomEvent('team-tasks-refresh')); setRoute(defaultRoute(user.role)) }} />}
          {route === 'task-details' && <TaskDetails taskId={selectedTask} user={user} editTask={(id) => { setSelectedTask(id); setRoute('task-form') }} onDeleted={() => setRoute(defaultRoute(user.role))} />}
          {route === 'reports' && <Reports user={user} openTask={openTask} />}
          {route === 'executive-report' && <Reports user={user} openTask={openTask} executive />}
          {route === 'kpi' && <Kpi user={user} openTask={openTask} />}
          {route === 'users' && <Users user={user} />}
          {route === 'departments' && <Departments user={user} />}
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
      {billsMessageOpen && (
        <BillsMessageModal
          recipientCount={billsMessageConfig?.recipient_count || 0}
          onClose={() => setBillsMessageOpen(false)}
        />
      )}
      {autoPausePrompt && (
        <AutoPausePrompt
          prompt={autoPausePrompt}
          onCancelPause={cancelAutoPause}
          onDismiss={() => setAutoPausePrompt(null)}
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

function BillsMessageModal({ recipientCount, onClose }) {
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sentCount, setSentCount] = useState(0)

  async function deliverMessage(value) {
    const nextMessage = value.trim()
    if (!nextMessage) return
    setSaving(true)
    setError('')
    setSentCount(0)
    try {
      const result = await api('/notifications/bills-message', {
        method: 'POST',
        body: JSON.stringify({ message: nextMessage }),
      })
      setSentCount(result.sent_count)
      setMessage('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function sendMessage(event) {
    event.preventDefault()
    deliverMessage(message)
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="briefing-modal bills-message-modal" role="dialog" aria-modal="true" aria-labelledby="bills-message-title" onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head">
          <div>
            <p className="eyebrow">تنبيه مستخدم الفواتير</p>
            <h2 id="bills-message-title">ماذا تحتاجون من مسؤول إدخال الفواتير؟</h2>
            <span>سيصل التنبيه إلى {recipientCount || 'كل'} مستخدمي إدخال الفواتير النشطين.</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="إغلاق"><X size={17} /></button>
        </header>
        <form className="bills-message-form" onSubmit={sendMessage}>
          <button className="bills-message-preset" type="button" disabled={saving || recipientCount === 0} onClick={() => deliverMessage('الفواتير جاهزة')}>
            <BellRing size={17} />{saving ? 'جارٍ الإرسال...' : 'إرسال: الفواتير جاهزة'}
          </button>
          <label>الرسالة المطلوبة
            <textarea
              autoFocus
              required
              maxLength="1000"
              value={message}
              onChange={(event) => { setMessage(event.target.value); setError(''); setSentCount(0) }}
              placeholder="اكتبوا بوضوح ماذا تحتاجون من مسؤول إدخال الفواتير..."
            />
            <small>{message.length}/1000</small>
          </label>
          {error && <p className="error">{error}</p>}
          {sentCount > 0 && <p className="success bills-message-success"><Check size={16} />تم إرسال التنبيه بنجاح.</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>إغلاق</button>
            <button className="primary" type="submit" disabled={saving || !message.trim() || recipientCount === 0}>
              <Send size={16} />{saving ? 'جارٍ الإرسال...' : 'إرسال التنبيه'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}


function BillsTodoColumn({ todos, onComplete }) {
  const [completingId, setCompletingId] = useState(null)
  const [error, setError] = useState('')

  async function complete(todo) {
    setCompletingId(todo.id)
    setError('')
    try {
      await onComplete(todo)
    } catch (err) {
      setError(err.message)
    } finally {
      setCompletingId(null)
    }
  }

  return (
    <aside className="bills-todo-column" aria-label="طلبات قسم المالية">
      <header>
        <div>
          <p className="eyebrow">قائمة المطلوب</p>
          <h2>طلبات قسم المالية</h2>
        </div>
        <span className="bills-todo-count">{todos.length}</span>
      </header>
      <p className="bills-todo-hint">تبقى الطلبات هنا حتى تضغطي على تم.</p>
      {error && <p className="error">{error}</p>}
      <div className="bills-todo-list">
        {todos.length ? todos.map((todo) => (
          <article className="bills-todo-item" key={todo.id}>
            <BellRing size={17} />
            <div>
              <strong>{todo.title}</strong>
              <p>{todo.message}</p>
              <small>{formatNotificationTime(todo.created_at)}</small>
            </div>
            <button type="button" disabled={completingId === todo.id} onClick={() => complete(todo)}>
              <Check size={15} />{completingId === todo.id ? 'جارٍ...' : 'تم'}
            </button>
          </article>
        )) : (
          <div className="bills-todo-empty"><Check size={18} /><span>لا توجد طلبات معلقة.</span></div>
        )}
      </div>
    </aside>
  )
}


function NotificationBell({
  notifications,
  open,
  onToggle,
  onOpenNotification,
  onMarkRead,
  onMarkAllRead,
  allowMarkAll = true,
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
            {allowMarkAll && notifications.length > 0 && <button type="button" onClick={onMarkAllRead}>تحديد الكل كمقروء</button>}
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
                  {notification.notification_type !== 'finance_message' && (
                    <button className="icon-button" type="button" onClick={() => onMarkRead(notification)} title="تحديد كمقروء" aria-label="تحديد كمقروء">
                      <Check size={16} />
                    </button>
                  )}
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

function AutoPausePrompt({ prompt, onCancelPause, onDismiss }) {
  const taskCount = prompt.tasks.length
  return (
    <div className="modal-backdrop" role="presentation" onClick={onDismiss}>
      <section className="briefing-modal end-of-day-modal" role="dialog" aria-modal="true" aria-labelledby="end-of-day-title" onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head">
          <div>
            <p className="eyebrow">{prompt.window.label}</p>
            <h2 id="end-of-day-title">{prompt.window.title}</h2>
          </div>
          <button className="icon-button" onClick={onDismiss} title="إغلاق" aria-label="إغلاق"><X size={18} /></button>
        </header>
        <p className="end-of-day-copy">
          تم نقل {taskCount} مهمة قيد التنفيذ إلى قائمة متوقف بسبب: <strong>{prompt.window.reason}</strong>. إذا كنت ما زلت تعمل، يمكنك إلغاء الإيقاف الآن وسيتم احتساب الوقت منذ لحظة الإيقاف.
        </p>
        <footer className="briefing-actions">
          <button type="button" onClick={onDismiss}>اتركها متوقفة</button>
          <button className="primary" type="button" onClick={onCancelPause}>إلغاء الإيقاف والمتابعة</button>
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

const autoPauseWindows = [
  {
    id: 'break',
    label: '12:30 PM',
    title: 'تم إيقاف المهام للاستراحة',
    reason: 'استراحة',
    start: { hour: 12, minute: 30 },
    cancelUntil: { hour: 12, minute: 45 },
  },
  {
    id: 'end-of-day',
    label: '5:00 PM',
    title: 'تم إيقاف المهام لنهاية اليوم',
    reason: 'END OF DAY',
    start: { hour: 17, minute: 0 },
    cancelUntil: { hour: 17, minute: 10 },
  },
]

function isInsideWindow(now, start, end) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const startMinutes = start.hour * 60 + start.minute
  const endMinutes = end.hour * 60 + end.minute
  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

function routeTitle(route) {
  const titles = {
    'my-tasks': 'مهامي',
    dashboard: 'لوحة القسم',
    'admin-dashboard': 'لوحة الإدارة',
    'task-form': 'إدارة المهمة',
    'task-details': 'تفاصيل المهمة',
    reports: 'التقارير',
    'executive-report': 'تقرير الإدارة التنفيذي',
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

function buildNav(user) {
  const role = user?.role
  const isSuperAdmin = role === 'super_admin'
  if (role === 'employee') {
    return [
      { route: 'my-tasks', label: 'مهامي', icon: ClipboardList },
      { route: 'task-form', label: 'إضافة مهمة', icon: Plus },
      { route: 'reports', label: 'تقريري', icon: BarChart3 },
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
  const adminNav = [
    { route: 'admin-dashboard', label: 'لوحة الإدارة', icon: ClipboardList },
    { route: 'task-form', label: 'إنشاء مهمة', icon: Plus },
    { route: 'reports', label: 'التقارير', icon: BarChart3 },
    ...(isSuperAdmin ? [{ route: 'executive-report', label: 'تقرير الإدارة التنفيذي', icon: BarChart3 }] : []),
    { route: 'kpi', label: 'مؤشرات الأداء (KPI)', icon: BarChart3 },
    { route: 'users', label: 'المستخدمون', icon: UsersIcon },
    { route: 'departments', label: 'الأقسام', icon: Building2 },
    { route: 'delay-reasons', label: 'أسباب التأخير', icon: BarChart3 },
  ]
  return adminNav
}
