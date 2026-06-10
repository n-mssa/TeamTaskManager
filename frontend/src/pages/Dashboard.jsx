import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import KanbanBoard from '../components/KanbanBoard'
import { statusLabels } from '../utils/labels'
import { statusChangePayload } from '../utils/tasks'
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

  const summary = useMemo(() => ({
    total: tasks.length,
    pending: tasks.filter((task) => task.status === 'pending').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    done: tasks.filter((task) => task.status === 'done').length,
    delayed: tasks.filter((task) => task.status === 'delayed' || (new Date(task.due_date) < new Date() && !['done', 'cancelled'].includes(task.status))).length,
  }), [tasks])

  async function updateStatus(task, nextStatus) {
    const payload = statusChangePayload(task, nextStatus)
    if (!payload) return
    await api(`/tasks/${task.id}/status`, { method: 'PATCH', body: JSON.stringify(payload) })
    load()
  }

  async function saveOverrunReason(task, reason) {
    await api(`/tasks/${task.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: task.status, overrun_reason_text: reason }),
    })
    load()
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
        <Stat icon={ListTodo} value={summary.total} label="إجمالي المهام" tone="slate" />
        <Stat icon={Clock3} value={summary.pending} label="بانتظار التنفيذ" tone="amber" />
        <Stat icon={PlayCircle} value={summary.inProgress} label="قيد التنفيذ" tone="blue" />
        <Stat icon={CheckCircle2} value={summary.done} label="منجزة" tone="green" />
        <Stat icon={AlertTriangle} value={summary.delayed} label="متأخرة" tone="red" />
      </div>
      <div className="filters compact">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} placeholder="رقم الموظف" />
      </div>
      {error && <p className="error">{error}</p>}
      <KanbanBoard tasks={tasks} onOpen={openTask} onMove={updateStatus} onOverrun={saveOverrunReason} />
    </section>
  )
}

function Stat({ icon: Icon, value, label, tone }) {
  return <div className={`stat-card tone-${tone}`}><span className="stat-icon"><Icon size={20} /></span><strong>{value}</strong><span>{label}</span></div>
}
