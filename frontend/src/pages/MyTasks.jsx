import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import KanbanBoard from '../components/KanbanBoard'
import { statusOptions } from '../utils/labels'

export default function MyTasks({ openTask }) {
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
    const payload = { status }
    if (status === 'delayed') {
      const reason = window.prompt('سبب التأخير')
      if (!reason) return
      payload.delay_reason_text = reason
    }
    await api(`/tasks/${task.id}/status`, { method: 'PATCH', body: JSON.stringify(payload) })
    load()
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
      <KanbanBoard tasks={visible} onOpen={openTask} onMove={updateStatus} />
    </section>
  )
}
