import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { priorityLabels, statusLabels } from '../utils/labels'

export default function TaskDetails({ taskId, editTask }) {
  const [task, setTask] = useState(null)
  const [comments, setComments] = useState([])
  const [history, setHistory] = useState([])
  const [comment, setComment] = useState('')

  async function load() {
    setTask(await api(`/tasks/${taskId}`))
    setComments(await api(`/tasks/${taskId}/comments`))
    setHistory(await api(`/tasks/${taskId}/history`))
  }

  useEffect(() => { load() }, [taskId])

  async function addComment(event) {
    event.preventDefault()
    if (!comment.trim()) return
    await api(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ comment_text: comment }) })
    setComment('')
    load()
  }

  if (!task) return <div className="empty">جار التحميل...</div>
  return (
    <section>
      <div className="page-head">
        <h1>{task.title}</h1>
        <button className="primary" onClick={() => editTask(task.id)}>تعديل مهمة</button>
      </div>
      <div className="details-grid">
        <div><span>الحالة</span><strong>{statusLabels[task.status]}</strong></div>
        <div><span>الأولوية</span><strong>{priorityLabels[task.priority]}</strong></div>
        <div><span>المكلف</span><strong>{task.assignee?.full_name_ar}</strong></div>
        <div><span>القسم</span><strong>{task.department?.name_ar}</strong></div>
        <div><span>الوقت المتوقع</span><strong>{task.expected_minutes} دقيقة</strong></div>
        <div><span>تاريخ التسليم</span><strong>{task.due_date}</strong></div>
        <div><span>بدأت في</span><strong>{task.started_at || '-'}</strong></div>
        <div><span>أنجزت في</span><strong>{task.completed_at || '-'}</strong></div>
      </div>
      <article className="panel"><h2>الوصف</h2><p>{task.description || 'لا يوجد وصف.'}</p></article>
      <article className="panel"><h2>سبب التأخير</h2><p>{task.delay_reason?.name_ar || task.delay_reason_text || 'لا يوجد.'}</p></article>
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
        {history.map((item) => <p key={item.id} className="note">{statusLabels[item.old_status] || '-'} ← {statusLabels[item.new_status]}<small>{item.changed_at}</small></p>)}
      </article>
    </section>
  )
}
