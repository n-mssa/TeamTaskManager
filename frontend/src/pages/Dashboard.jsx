import { useEffect, useMemo, useState, useRef } from 'react'
import { api } from '../api/client'
import KanbanBoard from '../components/KanbanBoard'
import TaskDetails from './TaskDetails'
import TaskDrawer from '../components/TaskDrawer'
import { statusOptions, statusLabels } from '../utils/labels'
import { isEndOfDayOverdue, isOverExpected, optimisticStatusTask, replaceTask, statusChangePayload } from '../utils/tasks'
import { AlertTriangle, CheckCircle2, Clock3, ListTodo, PlayCircle } from 'lucide-react'

export default function Dashboard({ user, openTask, createTask, editTask }) {
  const [tasks, setTasks] = useState([])
  const [status, setStatus] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const isAdmin = ['super_admin', 'admin'].includes(user?.role)

  async function load() {
    const params = new URLSearchParams()

    try {
      setTasks(await api(`/tasks${params.toString() ? `?${params}` : ''}`))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    window.addEventListener('team-tasks-refresh', load)
    return () => window.removeEventListener('team-tasks-refresh', load)
  }, [])

  useEffect(() => {
    const refreshTimer = window.setInterval(load, 30_000)
    return () => window.clearInterval(refreshTimer)
  }, [])

  const summary = useMemo(() => {
    const assignedThisMonth = tasks.filter((task) => isCurrentMonth(task.assigned_date || task.due_date))
    const completedThisMonth = tasks.filter((task) => task.status === 'done' && isCurrentMonth(task.completed_at))
    return {
      total: assignedThisMonth.length,
      pending: tasks.filter((task) => task.status === 'pending').length,
      inProgress: tasks.filter((task) => task.status === 'in_progress').length,
      done: completedThisMonth.length,
      delayed: tasks.filter((task) => task.status === 'delayed' || ((isOverExpected(task) || isEndOfDayOverdue(task)) && !['done', 'cancelled'].includes(task.status))).length,
    }
  }, [tasks])

  const visibleTasks = useMemo(() => tasks.filter(task =>
    (!status || task.status === status) &&
    (!assignedTo || String(task.assigned_to_user_id) === assignedTo) &&
    (!query.trim() || task.title.includes(query.trim()))
  ), [tasks, status, assignedTo, query])
  const assignees = [...new Map(tasks.map(task => [task.assigned_to_user_id, task.assignee?.full_name_ar || 'غير محدد'])).entries()]

  function reconcileTask(updatedTask) {
    setTasks(current => replaceTask(current, updatedTask))
  }

  async function updateStatus(task, nextStatus, extra = {}) {
    if (savingRef.current) return
    const payload = statusChangePayload(task, nextStatus, user, extra)
    if (!payload) return
    savingRef.current = true
    setSavingId(task.id)
    reconcileTask(optimisticStatusTask(task, payload))
    setError('')
    setNotice('جارٍ حفظ التغيير…')
    try {
      const updatedTask = await api(`/tasks/${task.id}/status`, { method: 'PATCH', body: JSON.stringify(payload) })
      reconcileTask(updatedTask)
      setNotice(`تم نقل «${task.title}» إلى ${statusLabels[nextStatus]}`)
    } catch (err) {
      reconcileTask(task)
      setNotice('')
      setError(`تعذّر حفظ النقل؛ أُعيدت المهمة لمكانها. ${err.message}`)
    } finally {
      savingRef.current = false
      setSavingId(null)
    }
  }

  async function saveOverrunReason(task, reason) {
    const reasonText = typeof reason === 'string' ? reason : reason.text
    const category = typeof reason === 'string' ? 'on_employee' : reason.category
    const payload = { status: task.status, overrun_reason_text: reasonText, overrun_reason_category: category }
    reconcileTask({ ...task, overrun_reason_text: reasonText, overrun_reason_category: category })
    try {
      const updatedTask = await api(`/tasks/${task.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      reconcileTask(updatedTask)
      await load()
      return updatedTask
    } catch (err) {
      reconcileTask(task)
      setError(err.message)
      return task
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <p className="eyebrow">{isAdmin ? 'كل الأقسام المتاحة' : 'قسمك فقط'}</p>
          <h1>{isAdmin ? 'لوحة الإدارة' : 'لوحة القسم'}</h1>
        </div>
        <button className="primary" onClick={createTask}>إنشاء مهمة</button>
      </div>
      <p className="ux-summary-note">الإحصائيات لكل المهام المتاحة لك — لا تتأثر بالبحث والفلاتر</p>
      <div className="stats">
        <Stat icon={ListTodo} value={summary.total} label="مهام أُسندت هذا الشهر" tone="slate" />
        <Stat icon={Clock3} value={summary.pending} label="بانتظار التنفيذ" tone="amber" />
        <Stat icon={PlayCircle} value={summary.inProgress} label="قيد التنفيذ" tone="blue" />
        <Stat icon={CheckCircle2} value={summary.done} label="منجزة هذا الشهر" tone="green" />
        <Stat icon={AlertTriangle} value={summary.delayed} label="تجاوزت الوقت" tone="red" />
      </div>
      <div className="filters compact">
        <label>الحالة<select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">كل الحالات</option>
          {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>الموظف<select value={assignedTo} onChange={event => setAssignedTo(event.target.value)}><option value="">كل الموظفين</option>{assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="ux-search">البحث<input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث باسم المهمة…" /></label>
        {(query || status || assignedTo) && <button onClick={() => {setQuery('');setStatus('');setAssignedTo('')}}>مسح الفلاتر</button>}
      </div>
      <p className="ux-summary-note">عرض {visibleTasks.length} من أصل {tasks.length} مهمة</p>
      {notice && <p className="ux-notice" role="status">{notice}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <KanbanBoard tasks={visibleTasks} user={user} savingId={savingId} onOpen={setDetailId} onMove={updateStatus} onOverrun={saveOverrunReason} />
      {detailId && <TaskDrawer onClose={() => setDetailId(null)}>
        <TaskDetails key={detailId} taskId={detailId} user={user} editTask={(id) => {setDetailId(null);(editTask || openTask)(id)}} onDeleted={() => {setDetailId(null);load()}} />
      </TaskDrawer>}
    </section>
  )
}

function Stat({ icon: Icon, value, label, tone }) {
  return <div className={`stat-card tone-${tone}`}><span className="stat-icon"><Icon size={20} /></span><strong>{value}</strong><span>{label}</span></div>
}

function isCurrentMonth(value) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}
