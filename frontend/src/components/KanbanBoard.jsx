import { useEffect, useRef, useState } from 'react'
import { Clock, CalendarDays, GripVertical } from 'lucide-react'
import { api } from '../api/client'
import { boardColumns, priorityLabels } from '../utils/labels'
import { elapsedSeconds, formatDuration, isOverExpected } from '../utils/tasks'
import EmptyState from './EmptyState'

export default function KanbanBoard({ tasks, user, onOpen, onMove, onOverrun }) {
  const [, setTick] = useState(0)
  const [delayReasons, setDelayReasons] = useState([])
  const [overrunRequest, setOverrunRequest] = useState(null)
  const promptedOverruns = useRef(new Set())

  useEffect(() => {
    api('/delay-reasons').then(setDelayReasons).catch(() => setDelayReasons([]))
  }, [])

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
        setOverrunRequest((current) => current || { task, nextStatus: null })
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [tasks, user, onOverrun])

  if (!tasks.length) return (
    <>
      <EmptyState title="لا توجد مهام مطابقة" description="جرّب تغيير عوامل التصفية أو إنشاء مهمة جديدة." />
      {overrunRequest && (
        <OverrunReasonModal
          task={overrunRequest.task}
          reasons={delayReasons}
          onCancel={() => setOverrunRequest(null)}
          onSubmit={submitOverrunReason}
        />
      )}
    </>
  )

  function handleDragStart(event, task) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(task.id))
  }

  function handleDrop(event, status) {
    event.preventDefault()
    const taskId = Number(event.dataTransfer.getData('text/plain'))
    const task = tasks.find((item) => item.id === taskId)
    if (!task || task.status === status) return
    if (needsOverrunReason(task, status, user)) {
      setOverrunRequest({ task, nextStatus: status })
      return
    }
    onMove(task, status)
  }

  async function submitOverrunReason(reason) {
    if (!overrunRequest) return
    const { task, nextStatus } = overrunRequest
    setOverrunRequest(null)
    const updatedTask = await onOverrun(task, reason)
    if (nextStatus) onMove(updatedTask || { ...task, overrun_reason_text: reason }, nextStatus)
  }

  return (
    <>
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
      {overrunRequest && (
        <OverrunReasonModal
          task={overrunRequest.task}
          reasons={delayReasons}
          onCancel={() => setOverrunRequest(null)}
          onSubmit={submitOverrunReason}
        />
      )}
    </>
  )
}

function needsOverrunReason(task, nextStatus, user) {
  return task.status === 'in_progress'
    && nextStatus !== 'in_progress'
    && user?.id === task.assigned_to_user_id
    && isOverExpected(task)
    && !task.overrun_reason_text
}

function OverrunReasonModal({ task, reasons, onCancel, onSubmit }) {
  const visibleReasons = reasons.filter((item) => !isOtherReasonLabel(item.name_ar) && !isOtherReasonLabel(item.name_en))
  const [selectedReason, setSelectedReason] = useState(visibleReasons[0]?.name_ar || '__other')
  const [customReason, setCustomReason] = useState('')
  const [error, setError] = useState('')
  const isOther = selectedReason === '__other'

  useEffect(() => {
    if (!selectedReason && visibleReasons[0]?.name_ar) setSelectedReason(visibleReasons[0].name_ar)
  }, [selectedReason, visibleReasons])

  function submit(event) {
    event.preventDefault()
    const reason = isOther ? customReason.trim() : selectedReason.trim()
    if (!reason) {
      setError('يرجى اختيار سبب أو كتابة سبب آخر.')
      return
    }
    onSubmit(reason)
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <form className="briefing-modal reason-modal" role="dialog" aria-modal="true" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head">
          <div>
            <p className="eyebrow">تجاوز الوقت المتوقع</p>
            <h2>اختيار سبب التأخير</h2>
          </div>
        </header>
        <p className="note">المهمة: <strong>{task.title}</strong></p>
        <label>السبب
          <select value={selectedReason} onChange={(event) => { setSelectedReason(event.target.value); setError('') }}>
            {visibleReasons.map((item) => <option key={item.id} value={item.name_ar}>{item.name_ar}</option>)}
            <option value="__other">أخرى</option>
          </select>
        </label>
        {isOther && (
          <label>سبب آخر
            <textarea value={customReason} onChange={(event) => { setCustomReason(event.target.value); setError('') }} autoFocus />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="briefing-actions">
          <button type="button" onClick={onCancel}>إلغاء</button>
          <button className="primary" type="submit">حفظ السبب</button>
        </div>
      </form>
    </div>
  )
}

function isOtherReasonLabel(label) {
  const normalized = String(label || '').trim().toLowerCase()
  return ['other', 'others', 'سبب آخر', 'اخرى', 'أخرى'].includes(normalized)
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
