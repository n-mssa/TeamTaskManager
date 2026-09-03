import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import KanbanBoard from '../components/KanbanBoard'
import { statusOptions } from '../utils/labels'
import { isOverExpected, optimisticStatusTask, replaceTask, statusChangePayload } from '../utils/tasks'
import { AlertTriangle, CheckCircle2, Clock3, ListTodo, PlayCircle } from 'lucide-react'

export default function Dashboard({ user, openTask, createTask }) {
  const [tasks, setTasks] = useState([])
  const [status, setStatus] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (assignedTo) params.set('assigned_to', assignedTo)
    try {
      setTasks(await api(`/tasks${params.toString() ? `?${params}` : ''}`))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [status, assignedTo])

  useEffect(() => {
    window.addEventListener('team-tasks-refresh', load)
    return () => window.removeEventListener('team-tasks-refresh', load)
  }, [status, assignedTo])

  const summary = useMemo(() => {
    const assignedThisMonth = tasks.filter((task) => isCurrentMonth(task.assigned_date || task.due_date))
    return {
      total: assignedThisMonth.length,
      pending: tasks.filter((task) => task.status === 'pending').length,
      inProgress: tasks.filter((task) => task.status === 'in_progress').length,
      done: assignedThisMonth.filter((task) => task.status === 'done').length,
      delayed: tasks.filter((task) => task.status === 'delayed' || (isOverExpected(task) && !['done', 'cancelled'].includes(task.status))).length,
    }
  }, [tasks])

  function reconcileTask(updatedTask) {
    setTasks((current) => {
      if (status && updatedTask.status !== status) return current.filter((item) => item.id !== updatedTask.id)
      return replaceTask(current, updatedTask)
    })
  }

  async function updateStatus(task, nextStatus, extra = {}) {
    const payload = statusChangePayload(task, nextStatus, user, extra)
    if (!payload) return
    reconcileTask(optimisticStatusTask(task, payload))
    setError('')
    try {
      const updatedTask = await api(`/tasks/${task.id}/status`, { method: 'PATCH', body: JSON.stringify(payload) })
      reconcileTask(updatedTask)
    } catch (err) {
      reconcileTask(task)
      setError(err.message)
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
          <p className="eyebrow">{user.role === 'admin' ? 'كل الأقسام' : 'قسمك فقط'}</p>
          <h1>{user.role === 'admin' ? 'لوحة الإدارة' : 'لوحة القسم'}</h1>
        </div>
        <button className="primary" onClick={createTask}>إنشاء مهمة</button>
      </div>
      <div className="stats">
        <Stat icon={ListTodo} value={summary.total} label="إجمالي مهام الشهر" tone="slate" />
        <Stat icon={Clock3} value={summary.pending} label="بانتظار التنفيذ" tone="amber" />
        <Stat icon={PlayCircle} value={summary.inProgress} label="قيد التنفيذ" tone="blue" />
        <Stat icon={CheckCircle2} value={summary.done} label="منجزة من مهام الشهر" tone="green" />
        <Stat icon={AlertTriangle} value={summary.delayed} label="تجاوزت الوقت" tone="red" />
      </div>
      <div className="filters compact">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">كل الحالات</option>
          {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} placeholder="رقم الموظف" />
      </div>
      {error && <p className="error">{error}</p>}
      <KanbanBoard tasks={tasks} user={user} onOpen={openTask} onMove={updateStatus} onOverrun={saveOverrunReason} />
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
