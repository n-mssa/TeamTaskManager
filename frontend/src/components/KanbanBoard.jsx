import { Clock, CalendarDays, GripVertical } from 'lucide-react'
import { boardColumns, priorityLabels } from '../utils/labels'

export default function KanbanBoard({ tasks, onOpen, onMove }) {
  if (!tasks.length) return <div className="empty">لا توجد مهام مطابقة.</div>

  function handleDragStart(event, task) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(task.id))
  }

  function handleDrop(event, status) {
    event.preventDefault()
    const taskId = Number(event.dataTransfer.getData('text/plain'))
    const task = tasks.find((item) => item.id === taskId)
    if (task && task.status !== status) onMove(task, status)
  }

  return (
    <div className="kanban-board">
      {boardColumns.map((column) => {
        const columnTasks = tasks.filter((task) => task.status === column.value)
        return (
          <section
            className="kanban-column"
            key={column.value}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, column.value)}
          >
            <header className="column-head">
              <span>{column.label}</span>
              <small>{columnTasks.length}</small>
            </header>
            <div className="column-list">
              {columnTasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} onDragStart={handleDragStart} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function TaskCard({ task, onOpen, onDragStart }) {
  const overdue = new Date(task.due_date) < new Date().setHours(0, 0, 0, 0) && !['done', 'cancelled'].includes(task.status)
  return (
    <article
      className={`task-card ${overdue ? 'is-overdue' : ''}`}
      draggable
      onDragStart={(event) => onDragStart(event, task)}
      onClick={() => onOpen(task.id)}
    >
      <div className="task-card-top">
        <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
        <GripVertical size={16} aria-hidden="true" />
      </div>
      <h3>{task.title}</h3>
      {task.description && <p>{task.description}</p>}
      <div className="task-meta">
        <span><Clock size={14} />{formatMinutes(task.expected_minutes)}</span>
        <span><CalendarDays size={14} />{task.due_date}</span>
      </div>
      <div className="task-footer">
        <span>{task.assignee?.full_name_ar || 'غير محدد'}</span>
        <small>{task.department?.name_ar || ''}</small>
      </div>
      {task.delay_reason && <small className="delay-note">{task.delay_reason.name_ar}</small>}
    </article>
  )
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours}س ${rest}د`
  if (hours) return `${hours}س`
  return `${rest}د`
}
