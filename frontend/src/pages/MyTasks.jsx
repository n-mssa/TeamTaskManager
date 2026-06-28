import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import KanbanBoard from '../components/KanbanBoard'
import { statusOptions } from '../utils/labels'
import { optimisticStatusTask, replaceTask, statusChangePayload } from '../utils/tasks'

export default function MyTasks({ user, openTask }) {
  const [tasks, setTasks] = useState([])
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')

  async function load() {
    try {
      setTasks(await api('/tasks'))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    if (filter === 'overdue') {
      const today = new Date().setHours(0, 0, 0, 0)
      return tasks.filter((task) => new Date(task.due_date) < today && !['done', 'cancelled'].includes(task.status))
    }
    if (filter === 'all') return tasks
    return tasks.filter((task) => task.status === filter)
  }, [filter, tasks])

  async function updateStatus(task, status) {
    const payload = statusChangePayload(task, status, user)
    if (!payload) return
    setTasks((current) => replaceTask(current, optimisticStatusTask(task, payload)))
    setError('')
    try {
      const updatedTask = await api(`/tasks/${task.id}/status`, { method: 'PATCH', body: JSON.stringify(payload) })
      setTasks((current) => replaceTask(current, updatedTask))
    } catch (err) {
      setTasks((current) => replaceTask(current, task))
      setError(err.message)
    }
  }

  async function saveOverrunReason(task, reason) {
    const payload = { status: task.status, overrun_reason_text: reason }
    setTasks((current) => replaceTask(current, { ...task, overrun_reason_text: reason }))
    try {
      const updatedTask = await api(`/tasks/${task.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setTasks((current) => replaceTask(current, updatedTask))
    } catch (err) {
      setTasks((current) => replaceTask(current, task))
      setError(err.message)
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>مهامي</h1>
      </div>
      <div className="filters compact">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>الكل</button>
        {statusOptions.map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
        <button className={filter === 'overdue' ? 'active' : ''} onClick={() => setFilter('overdue')}>متأخرة عن موعدها</button>
      </div>
      {error && <p className="error">{error}</p>}
      <KanbanBoard tasks={visible} user={user} onOpen={openTask} onMove={updateStatus} onOverrun={saveOverrunReason} />
    </section>
  )
}
