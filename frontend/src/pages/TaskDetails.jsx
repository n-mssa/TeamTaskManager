import { useEffect, useState } from 'react'
import { API_BASE_URL, api, getToken } from '../api/client'
import { priorityLabels, statusLabels } from '../utils/labels'
import { elapsedSeconds, formatDuration } from '../utils/tasks'

function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

const delayCategoryLabels = {
  on_employee: 'على الموظف',
  shared: 'سبب مشترك',
  external: 'سبب خارجي',
}

const expectedTimeComplaintStatusLabels = {
  pending: 'بانتظار المراجعة',
  accepted: 'تم قبول الاعتراض',
  denied: 'تم رفض الاعتراض',
  none: 'غير مراجع',
}

export default function TaskDetails({ taskId, user, editTask, onDeleted }) {
  const [task, setTask] = useState(null)
  const [comments, setComments] = useState([])
  const [history, setHistory] = useState([])
  const [comment, setComment] = useState('')
  const [delayCategory, setDelayCategory] = useState('on_employee')
  const [productionIssueReason, setProductionIssueReason] = useState('')
  const [, setTick] = useState(0)

  async function load() {
    const [nextTask, nextComments, nextHistory] = await Promise.all([
      api(`/tasks/${taskId}`),
      api(`/tasks/${taskId}/comments`),
      api(`/tasks/${taskId}/history`),
    ])
    setTask(nextTask)
    setDelayCategory(nextTask.overrun_reason_category || 'on_employee')
    setProductionIssueReason(nextTask.production_issue_reason || '')
    setComments(nextComments)
    setHistory(nextHistory)
  }

  useEffect(() => { load() }, [taskId])
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  async function addComment(event) {
    event.preventDefault()
    if (!comment.trim()) return
    await api(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ comment_text: comment }) })
    setComment('')
    load()
  }

  async function deleteTask() {
    const reason = window.prompt('سبب حذف المهمة')
    if (!reason?.trim()) return
    if (!window.confirm('سيتم إخفاء المهمة مع الاحتفاظ بسجل الحذف. هل أنت متأكد؟')) return
    await api(`/tasks/${taskId}`, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) })
    onDeleted()
  }

  async function downloadAttachment(attachment) {
    const response = await fetch(`${API_BASE_URL}/tasks/${task.id}/attachments/${attachment.id}/download`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!response.ok) return
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = attachment.original_filename
    link.click()
    window.URL.revokeObjectURL(url)
  }

  async function saveDelayReview(approved) {
    const updatedTask = await api(`/tasks/${task.id}/delay-review`, {
      method: 'PATCH',
      body: JSON.stringify({ overrun_reason_category: delayCategory, overrun_reason_approved: approved }),
    })
    setTask(updatedTask)
  }

  async function saveProductionIssue(flagged) {
    const updatedTask = await api(`/tasks/${task.id}/production-issue`, {
      method: 'PATCH',
      body: JSON.stringify({ flagged, reason: flagged ? productionIssueReason : null }),
    })
    setTask(updatedTask)
    setProductionIssueReason(updatedTask.production_issue_reason || '')
  }

  if (!task) return <div className="empty">جار التحميل...</div>
  const canReviewDelay = user.role === 'admin' || user.role === 'manager'
  const canFlagProductionIssue = canReviewDelay && task.status === 'done'
  return (
    <section>
      <div className="page-head">
        <h1>{task.title}</h1>
        <div className="actions">
          {user.role !== 'employee' && <button className="primary" onClick={() => editTask(task.id)}>تعديل مهمة</button>}
          {user.role === 'admin' && <button className="danger" onClick={deleteTask}>حذف المهمة</button>}
        </div>
      </div>
      <div className="details-grid">
        <div><span>الحالة</span><strong>{statusLabels[task.status]}</strong></div>
        <div><span>الأولوية</span><strong>{priorityLabels[task.priority]}</strong></div>
        <div><span>المكلف</span><strong>{task.assignee?.full_name_ar}</strong></div>
        <div><span>القسم</span><strong>{task.department?.name_ar}</strong></div>
        <div><span>الوقت المتوقع</span><strong>{task.expected_minutes} دقيقة</strong></div>
        <div><span>الوقت الفعلي</span><strong className={elapsedSeconds(task) > task.expected_minutes * 60 ? 'timer-over' : ''}>{formatDuration(elapsedSeconds(task))}</strong></div>
        <div><span>تاريخ الإسناد</span><strong>{task.due_date}</strong></div>
        <div><span>بدأت في</span><strong>{formatDateTime(task.started_at)}</strong></div>
        <div><span>أنجزت في</span><strong>{formatDateTime(task.completed_at)}</strong></div>
      </div>
      <article className="panel"><h2>الوصف</h2><p>{task.description || 'لا يوجد وصف.'}</p></article>
      <article className="panel">
        <h2>المرفقات</h2>
        {task.attachments?.length ? (
          <div className="attachment-list">
            {task.attachments.map((attachment) => (
              <button key={attachment.id} type="button" onClick={() => downloadAttachment(attachment)}>
                <strong>{attachment.original_filename}</strong>
                <small>{formatFileSize(attachment.size_bytes)}</small>
              </button>
            ))}
          </div>
        ) : (
          <p>لا توجد مرفقات.</p>
        )}
      </article>
      <article className="panel"><h2>سبب التأخير</h2><p>{task.delay_reason?.name_ar || task.delay_reason_text || 'لا يوجد.'}</p></article>
      <article className="panel"><h2>سبب الانتظار</h2><p>{task.hold_reason_text || 'لا يوجد.'}</p></article>
      {task.status === 'done' && (
        <article className="panel production-issue-panel">
          <h2>مشكلة إنتاج</h2>
          <div className="production-issue-status">
            <img src={task.production_issue_flagged ? '/assets/flag-red.png' : '/assets/flag-grey.png'} alt="" />
            <span>{task.production_issue_flagged ? 'تم تسجيل مشكلة إنتاج' : 'لا توجد مشكلة إنتاج مسجلة'}</span>
          </div>
          {task.production_issue_reason && <p>{task.production_issue_reason}</p>}
          {canFlagProductionIssue && (
            <div className="inline-form production-issue-form">
              <input value={productionIssueReason} onChange={(event) => setProductionIssueReason(event.target.value)} placeholder="سبب المشكلة: بليتات ناقصة، ملف ناقص، تأخير إنتاج..." />
              <button type="button" onClick={() => saveProductionIssue(true)}>رفع العلم</button>
              {task.production_issue_flagged && <button type="button" onClick={() => saveProductionIssue(false)}>إزالة العلم</button>}
            </div>
          )}
        </article>
      )}
      <article className="panel">
        <h2>سبب تجاوز الوقت المتوقع</h2>
        <p>{task.overrun_reason_text || 'لا يوجد.'}</p>
        {task.overrun_reason_text && (
          <div className="delay-review">
            <span>التصنيف الحالي: {delayCategoryLabels[task.overrun_reason_category] || delayCategoryLabels.on_employee}</span>
            <span>الاعتماد: {task.overrun_reason_approved ? 'معتمد' : 'بانتظار الاعتماد'}</span>
            {canReviewDelay && (
              <div className="inline-form">
                <select value={delayCategory} onChange={(event) => setDelayCategory(event.target.value)}>
                  <option value="on_employee">على الموظف</option>
                  <option value="shared">سبب مشترك</option>
                  <option value="external">سبب خارجي</option>
                </select>
                <button type="button" onClick={() => saveDelayReview(true)}>اعتماد</button>
                <button type="button" onClick={() => saveDelayReview(false)}>إلغاء الاعتماد</button>
              </div>
            )}
          </div>
        )}
      </article>
      {task.expected_time_complaint_text && (
        <article className="panel">
          <h2>اعتراض على الوقت المتوقع</h2>
          <p>{task.expected_time_complaint_text}</p>
          <p className="note">الحالة: {expectedTimeComplaintStatusLabels[task.expected_time_complaint_status] || expectedTimeComplaintStatusLabels.pending}</p>
          <small>{formatDateTime(task.expected_time_complaint_at)}</small>
        </article>
      )}
      <article className="panel">
        <h2>التعليقات</h2>
        <form className="inline-form" onSubmit={addComment}>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="إضافة ملاحظة" />
          <button>إضافة ملاحظة</button>
        </form>
        {comments.map((item) => <p key={item.id} className="note">{item.comment_text}<small>{item.user?.full_name_ar} - {formatDateTime(item.created_at)}</small></p>)}
      </article>
      <article className="panel">
        <h2>سجل الحالة</h2>
        {history.map((item) => <p key={item.id} className="note">{statusLabels[item.old_status] || '-'} ← {statusLabels[item.new_status]}{item.reason_text && <small>السبب: {item.reason_text}</small>}<small>{formatDateTime(item.changed_at)}</small></p>)}
      </article>
    </section>
  )
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Amman',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((current, part) => {
    current[part.type] = part.value
    return current
  }, {})
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}`
}
