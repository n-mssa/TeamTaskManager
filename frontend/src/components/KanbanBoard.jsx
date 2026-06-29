import { useEffect, useRef, useState } from 'react'
import { Clock, CalendarDays, GripVertical } from 'lucide-react'
import { boardColumns, priorityLabels } from '../utils/labels'
import { elapsedSeconds, formatDuration, isOverExpected } from '../utils/tasks'
import EmptyState from './EmptyState'

export default function KanbanBoard({ tasks, user, onOpen, onMove, onOverrun }) {
  const [, setTick] = useState(0)
  const promptedOverruns = useRef(new Set())
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((value) => value + 1)
      tasks.forEach((task) => {
        const needsReason = task.status === 'in_progress'
          && user?.id === task.assigned_to_user_id
          && elapsedSeconds(task) > task.expected_minutes * 60
          && !task.overrun_reason_text
          && !promptedOverruns.current.has(task.id)
        if (!needsReason) return
        promptedOverruns.current.add(task.id)
        const reason = window.prompt(`تجاوزت المهمة الوقت المتوقع. يرجى كتابة سبب التجاوز:\n${task.title}`)
        if (reason?.trim()) onOverrun(task, reason.trim())
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [tasks, user, onOverrun])

  if (!tasks.length) return <EmptyState title="لا توجد مهام مطابقة" description="جرّب تغيير عوامل التصفية أو إنشاء مهمة جديدة." />

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
        const columnTasks = tasks.filter((task) => task.status === column.value && !isOldCompletedTask(task))
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
              {columnTasks.length
                ? columnTasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} onDragStart={handleDragStart} />)
                : <EmptyState compact title="لا توجد مهام" description="اسحب مهمة إلى هذه القائمة." />}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function TaskCard({ task, onOpen, onDragStart }) {
  const worked = elapsedSeconds(task)
  const overExpected = isOverExpected(task)
  const progress = Math.min(100, Math.round((worked / (task.expected_minutes * 60)) * 100))
  return (
    <article
      className={`task-card ${overExpected ? 'is-overdue' : ''}`}
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
        <span><CalendarDays size={14} />إسناد {task.due_date}</span>
      </div>
      <div className={`live-timer ${overExpected ? 'is-over' : ''}`}>
        الوقت الفعلي: {formatDuration(worked)} {overExpected ? '• تجاوز المتوقع' : ''}
      </div>
      <div className="task-progress" aria-label={`نسبة الوقت المستخدم ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="task-footer">
        <span>{task.assignee?.full_name_ar || 'غير محدد'}</span>
        <small>{task.department?.name_ar || ''}</small>
      </div>
      {task.delay_reason && <small className="delay-note">{task.delay_reason.name_ar}</small>}
      {task.hold_reason_text && task.status === 'blocked' && <small className="delay-note">سبب الانتظار: {task.hold_reason_text}</small>}
    </article>
  )
}

function isOldCompletedTask(task) {
  return task.status === 'done' && task.completed_at && Date.now() - new Date(task.completed_at).getTime() >= 7 * 24 * 60 * 60 * 1000
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours}س ${rest}د`
  if (hours) return `${hours}س`
  return `${rest}د`
}
