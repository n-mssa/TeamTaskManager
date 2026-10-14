import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Clock, CalendarDays, FileCheck2, GripVertical, AlertTriangle, Flag, CheckCircle2, MessageCircle, PauseCircle, Circle, PlayCircle } from 'lucide-react'
import { api } from '../api/client'
import { boardColumns, priorityLabels, statusLabels } from '../utils/labels'
import { elapsedSeconds, formatDuration, isEndOfDayOverdue, isOverExpected, timerExpectedMinutes } from '../utils/tasks'
import EmptyState from './EmptyState'

export default function KanbanBoard({ tasks, user, onOpen, onMove, onOverrun, savingId = null }) {
  const [, setTick] = useState(0)
  const [delayReasons, setDelayReasons] = useState([])
  const [overrunRequest, setOverrunRequest] = useState(null)
  const [finishRequest, setFinishRequest] = useState(null)
  const [holdRequest, setHoldRequest] = useState(null)
  const boardRef = useRef(null)
  const positions = useRef(new Map())
  const [draggedId, setDraggedId] = useState(null)
  const [dropColumn, setDropColumn] = useState(null)

  useLayoutEffect(() => {
    const next = new Map()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    boardRef.current?.querySelectorAll('[data-task-id]').forEach((card) => {
      const rect = card.getBoundingClientRect()
      const previous = positions.current.get(card.dataset.taskId)
      next.set(card.dataset.taskId, rect)
      if (!reducedMotion && previous && card.animate) {
        const x = previous.left - rect.left
        const y = previous.top - rect.top
        if (x || y) card.animate([
          { transform: `translate(${x}px, ${y}px)`, opacity: 0.75 },
          { transform: 'translate(0, 0)', opacity: 1 },
        ], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
      }
    })
    positions.current = next
  }, [tasks])

  function clearDrag() {
    setDraggedId(null)
    setDropColumn(null)
  }

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
          && elapsedSeconds(task) > timerExpectedMinutes(task) * 60
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
      {holdRequest && (
        <HoldReasonModal
          task={holdRequest}
          onCancel={() => setHoldRequest(null)}
          onSubmit={submitHoldReason}
        />
      )}
    </>
  )

  function handleDragStart(event, task) {
    setDraggedId(task.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(task.id))
  }

  function handleDrop(event, status) {
    event.preventDefault()
    clearDrag()
    const taskId = Number(event.dataTransfer.getData('text/plain'))
    const task = tasks.find((item) => item.id === taskId)
    requestMove(task, status)
  }

  function requestMove(task, status) {
    if (savingId || !task || task.status === status) return
    if (!canMoveToStatus(task, status)) return
    if (needsOverrunReason(task, status, user)) {
      setOverrunRequest({ task, nextStatus: status })
      return
    }
    if (needsCompletionComplaint(task, status, user)) {
      setFinishRequest(task)
      return
    }
    if (needsHoldReason(task, status)) {
      setHoldRequest(task)
      return
    }
    onMove(task, status)
  }

  async function submitOverrunReason(reason) {
    if (!overrunRequest) return
    const { task, nextStatus } = overrunRequest
    setOverrunRequest(null)
    const updatedTask = await onOverrun(task, reason)
    const taskWithReason = updatedTask || { ...task, overrun_reason_text: reason.text || reason, overrun_reason_category: reason.category || 'on_employee' }
    if (nextStatus === 'done' && needsCompletionComplaint(taskWithReason, nextStatus, user)) {
      setFinishRequest(taskWithReason)
      return
    }
    if (nextStatus === 'blocked' && needsHoldReason(taskWithReason, nextStatus)) {
      setHoldRequest(taskWithReason)
      return
    }
    if (nextStatus) onMove(taskWithReason, nextStatus)
  }

  function submitHoldReason(reason) {
    if (!holdRequest) return
    const task = holdRequest
    setHoldRequest(null)
    onMove(task, 'blocked', { hold_reason_text: reason.text })
  }

  function finishTask(complaintText = '') {
    if (!finishRequest) return
    const extra = complaintText.trim() ? { expected_time_complaint_text: complaintText.trim() } : {}
    const task = finishRequest
    setFinishRequest(null)
    onMove(task, 'done', extra)
  }

  return (
    <>
      <div className="kanban-board" ref={boardRef} onDragEnd={clearDrag}>
        {boardColumns.map((column) => {
          const columnTasks = tasks.filter((task) => task.status === column.value && !isOldCompletedTask(task))
          return (
            <section
              className={`kanban-column status-${column.value} ${dropColumn === column.value ? 'is-drop-target' : ''}`}
              key={column.value}
              onDragOver={(event) => {
                const dragged = tasks.find((item) => item.id === draggedId)
                if (!dragged || dragged.status === column.value || !canMoveToStatus(dragged, column.value)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropColumn(column.value)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDropColumn(null)
              }}
              onDrop={(event) => handleDrop(event, column.value)}
            >
              <header className="column-head">
                <span className="column-title"><StatusIcon status={column.value} />{column.label}</span>
                <small>{columnTasks.length}</small>
              </header>
              <div className="column-list">
                {columnTasks.length
                  ? columnTasks.map((task) => <TaskCard key={task.id} task={task} dragging={draggedId === task.id} busy={savingId !== null} onAction={requestMove} onOpen={onOpen} onDragStart={handleDragStart} />)
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
      {finishRequest && (
        <CompletionComplaintModal
          task={finishRequest}
          onCancel={() => setFinishRequest(null)}
          onFinish={finishTask}
        />
      )}
      {holdRequest && (
        <HoldReasonModal
          task={holdRequest}
          onCancel={() => setHoldRequest(null)}
          onSubmit={submitHoldReason}
        />
      )}
    </>
  )
}

function canMoveToStatus(task, nextStatus) {
  return nextStatus !== 'pending' || task.status === 'pending'
}

function needsOverrunReason(task, nextStatus, user) {
  return task.status === 'in_progress'
    && nextStatus !== 'in_progress'
    && user?.id === task.assigned_to_user_id
    && isOverExpected(task)
    && !task.overrun_reason_text
}

function needsCompletionComplaint(task, nextStatus, user) {
  return nextStatus === 'done'
    && task.status !== 'done'
    && user?.id === task.assigned_to_user_id
}

function needsHoldReason(task, nextStatus) {
  return nextStatus === 'blocked' && task.status !== 'blocked'
}

const holdReasonGroups = [
  {
    label: 'أسباب خارجية',
    options: [
      'بانتظار معلومات من العميل',
      'بانتظار موافقة العميل',
      'بانتظار ملفات أو مرفقات من العميل',
      'تعديل مطلوب من العميل',
      'تأخير من المورد',
      'بانتظار عينة أو مقاس من العميل',
    ],
  },
  {
    label: 'أسباب داخلية',
    options: [
      'نهاية اليوم',
      'استراحة',
      'تم استلام مهمة أكثر أولوية',
      'بانتظار اعتماد المدير',
      'بانتظار ملفات من المدير',
      'بانتظار مراجعة داخلية',
      'إعادة جدولة حسب توجيه الإدارة',
      'مشكلة في النظام',
      'اجتماع أو تدريب',
    ],
  },
]

function HoldReasonModal({ task, onCancel, onSubmit }) {
  const [selectedReason, setSelectedReason] = useState(holdReasonGroups[0].options[0])
  const [customReason, setCustomReason] = useState('')
  const [error, setError] = useState('')
  const isOther = selectedReason === '__other'

  function submit(event) {
    event.preventDefault()
    const reason = isOther ? customReason.trim() : selectedReason.trim()
    if (!reason) {
      setError('يرجى اختيار سبب أو كتابة سبب آخر.')
      return
    }
    onSubmit({ text: reason })
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <form className="briefing-modal reason-modal" role="dialog" aria-modal="true" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head">
          <div>
            <p className="eyebrow">إيقاف المهمة مؤقتاً</p>
            <h2>اختيار سبب التوقف</h2>
          </div>
        </header>
        <p className="note">المهمة: <strong>{task.title}</strong></p>
        <label>السبب
          <select value={selectedReason} onChange={(event) => { setSelectedReason(event.target.value); setError('') }}>
            {holdReasonGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </optgroup>
            ))}
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
          <button className="primary" type="submit">نقل إلى متوقف</button>
        </div>
      </form>
    </div>
  )
}

function OverrunReasonModal({ task, reasons, onCancel, onSubmit }) {
  const visibleReasons = reasons.filter((item) => !isOtherReasonLabel(item.name_ar) && !isOtherReasonLabel(item.name_en))
  const [selectedReason, setSelectedReason] = useState(visibleReasons[0]?.name_ar || '__other')
  const [category, setCategory] = useState('on_employee')
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
    onSubmit({ text: reason, category })
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
        <label>على من يُحسب التأخير؟
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="on_employee">على الموظف</option>
            <option value="shared">سبب مشترك</option>
            <option value="external">سبب خارجي</option>
          </select>
        </label>
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

function CompletionComplaintModal({ task, onCancel, onFinish }) {
  const [showComplaint, setShowComplaint] = useState(false)
  const [complaintText, setComplaintText] = useState('')

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <form className="briefing-modal reason-modal" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); onFinish(complaintText) }} onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head">
          <div>
            <p className="eyebrow">إنهاء المهمة</p>
            <h2>هل الوقت المتوقع كان مناسباً؟</h2>
          </div>
        </header>
        <p className="note">المهمة: <strong>{task.title}</strong></p>
        {!showComplaint ? (
          <div className="completion-choice-grid">
            <button type="button" className="completion-choice is-good" onClick={() => onFinish('')} aria-label="الوقت مناسب">
              <CheckCircle2 size={32} aria-hidden="true" />
              <strong>الوقت مناسب</strong>
            </button>
            <button type="button" className="completion-choice is-bad" onClick={() => setShowComplaint(true)} aria-label="الوقت غير مناسب">
              <MessageCircle size={32} aria-hidden="true" />
              <strong>الوقت غير مناسب</strong>
            </button>
          </div>
        ) : (
          <>
            <label>اشرح سبب الاعتراض على الوقت المتوقع
              <textarea value={complaintText} onChange={(event) => setComplaintText(event.target.value)} placeholder="مثال: الوقت المتوقع كان أقل من المطلوب بسبب كثرة التعديلات." autoFocus />
            </label>
            <div className="briefing-actions">
              <button type="button" onClick={() => setShowComplaint(false)}>رجوع</button>
              <button className="primary" type="submit">إنهاء وإرسال الاعتراض</button>
            </div>
          </>
        )}
        {!showComplaint && <div className="briefing-actions"><button type="button" onClick={onCancel}>إلغاء</button></div>}
      </form>
    </div>
  )
}

function TaskCard({ task, dragging, busy, onAction, onOpen, onDragStart }) {
  const worked = elapsedSeconds(task)
  const overExpected = isOverExpected(task)
  const missedEndOfDay = isEndOfDayOverdue(task)
  const visuallyOverdue = overExpected || missedEndOfDay
  const sharedExpectedMinutes = timerExpectedMinutes(task)
  const progress = Math.min(100, Math.round((worked / (sharedExpectedMinutes * 60)) * 100))
  const pendingSelfApproval = task.created_by_user_id === task.assigned_to_user_id && task.self_created_approved === false
  const pausedTooLong = isPausedTooLong(task)
  return (
    <article
      data-task-id={task.id}
      className={`task-card status-${task.status} ${dragging ? 'is-dragging' : ''} ${visuallyOverdue ? 'is-overdue' : ''} ${pendingSelfApproval ? 'is-pending-approval' : ''} ${pausedTooLong ? 'is-paused-too-long' : ''} ${task.has_sanad ? 'has-sanad' : ''} ${task.split_group_id ? 'is-split-task' : ''}`}
      draggable={!busy}
      onDragStart={(event) => onDragStart(event, task)}
      onClick={() => onOpen(task.id)}
    >
      {pausedTooLong && (
        <span className="paused-too-long-badge" title="المهمة متوقفة منذ أكثر من 3 أيام">
          <AlertTriangle size={18} aria-label="المهمة متوقفة منذ أكثر من 3 أيام" />
        </span>
      )}
      <div className="task-card-top">
        <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
        <span className="task-card-corner">
          <GripVertical size={16} aria-hidden="true" />
          {task.status === 'done' && <ProductionFlag flagged={task.production_issue_flagged} />}
        </span>
      </div>
      {pendingSelfApproval && <span className="approval-badge">بانتظار الاعتماد</span>}
      {task.split_group_id && <span className="split-task-badge">مهمة مقسمة · الجزء 1.{task.split_part}</span>}
      {task.has_sanad && <span className="sanad-badge"><FileCheck2 size={13} />تم إرفاق السند</span>}
      {missedEndOfDay && <span className="eod-overdue-badge">لم تُنجز قبل نهاية اليوم</span>}
      <h3><button className="ux-task-title" onClick={event => {event.stopPropagation();onOpen(task.id)}}>{task.title}</button></h3>

      <div className="task-meta">
        <span><Clock size={14} />{task.split_group_id ? `${formatMinutes(sharedExpectedMinutes)} إجمالي` : formatMinutes(task.expected_minutes)}</span>
        <span><CalendarDays size={14} />إسناد {task.due_date}</span>
      </div>
      <div className={`live-timer ${overExpected ? 'is-over' : ''}`}>
        الوقت الفعلي: {formatDuration(worked)} {overExpected ? `• تجاوز بـ ${formatDuration(worked - sharedExpectedMinutes * 60)}` : ''}
      </div>
      <div className="task-progress" aria-label={`نسبة الوقت المستخدم ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="task-footer">
        <span>{task.assignee?.full_name_ar || 'غير محدد'}</span>
        <small>{task.department?.name_ar || ''}</small>
      </div>
      {!['done', 'cancelled'].includes(task.status) && <div className="ux-task-actions" onClick={event => event.stopPropagation()}>
        {task.status !== 'in_progress' && <button disabled={busy} onClick={() => onAction(task, 'in_progress')}><PlayCircle size={15} />{task.status === 'blocked' ? 'استئناف' : 'ابدأ'}</button>}
        {task.status === 'in_progress' && <button disabled={busy} onClick={() => onAction(task, 'blocked')}><PauseCircle size={15} />أوقف</button>}
        <button disabled={busy} onClick={() => onAction(task, 'done')}><CheckCircle2 size={15} />أنجز</button>
      </div>}
      {task.delay_reason && <small className="delay-note">{task.delay_reason.name_ar}</small>}
      {task.hold_reason_text && task.status === 'blocked' && <small className="delay-note">سبب الانتظار: {task.hold_reason_text}</small>}
      {pausedTooLong && <small className="pause-warning">هذه المهمة متوقفة منذ أكثر من 3 أيام، يرجى مراجعتها.</small>}
    </article>
  )
}

function ProductionFlag({ flagged }) {
  return (
    <Flag
      size={17}
      className={`production-flag ${flagged ? 'is-flagged' : ''}`}
      aria-label={flagged ? 'مشكلة إنتاج مسجلة' : 'لا توجد مشكلة إنتاج'}
    />
  )
}

function isOldCompletedTask(task) {
  return task.status === 'done' && task.completed_at && Date.now() - new Date(task.completed_at).getTime() >= 7 * 24 * 60 * 60 * 1000
}

function isPausedTooLong(task) {
  if (task.status !== 'blocked' || !task.updated_at) return false
  const pausedAt = new Date(task.updated_at).getTime()
  if (!Number.isFinite(pausedAt)) return false
  return Date.now() - pausedAt >= 3 * 24 * 60 * 60 * 1000
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours}س ${rest}د`
  if (hours) return `${hours}س`
  return `${rest}د`
}

function StatusIcon({ status }) {
  const Icon = { pending: Circle, in_progress: PlayCircle, blocked: PauseCircle, done: CheckCircle2 }[status] || Circle
  return <Icon size={17} aria-hidden="true" />
}
