import { useEffect, useState } from 'react'
import { API_BASE_URL, api, getToken } from '../api/client'
import { priorityLabels, statusLabels } from '../utils/labels'
import { elapsedSeconds, formatDuration } from '../utils/tasks'

function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export default function TaskDetails({ taskId, user, editTask, onDeleted }) {
  const [task, setTask] = useState(null)
  const [comments, setComments] = useState([])
  const [history, setHistory] = useState([])
  const [comment, setComment] = useState('')
  const [, setTick] = useState(0)

  async function load() {
    const [nextTask, nextComments, nextHistory] = await Promise.all([
      api(`/tasks/${taskId}`),
      api(`/tasks/${taskId}/comments`),
      api(`/tasks/${taskId}/history`),
    ])
    setTask(nextTask)
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

  if (!task) return <div className="empty">جار التحميل...</div>
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
        <div><span>بدأت في</span><strong>{task.started_at || '-'}</strong></div>
        <div><span>أنجزت في</span><strong>{task.completed_at || '-'}</strong></div>
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
      <article className="panel"><h2>سبب تجاوز الوقت المتوقع</h2><p>{task.overrun_reason_text || 'لا يوجد.'}</p></article>
      <article className="panel">
        <h2>التعليقات</h2>
        <form className="inline-form" onSubmit={addComment}>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="إضافة ملاحظة" />
          <button>إضافة ملاحظة</button>
        </form>
        {comments.map((item) => <p key={item.id} className="note">{item.comment_text}<small>{item.user?.full_name_ar} - {item.created_at}</small></p>)}
      </article>
      <article className="panel">
        <h2>سجل الحالة</h2>
        {history.map((item) => <p key={item.id} className="note">{statusLabels[item.old_status] || '-'} ← {statusLabels[item.new_status]}{item.reason_text && <small>السبب: {item.reason_text}</small>}<small>{item.changed_at}</small></p>)}
      </article>
    </section>
  )
}
