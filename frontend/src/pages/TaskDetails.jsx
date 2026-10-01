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
  const [editingCommentId, setEditingCommentId] = useState(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  const [delayCategory, setDelayCategory] = useState('on_employee')
  const [productionIssueReason, setProductionIssueReason] = useState('')
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitUsers, setSplitUsers] = useState([])
  const [splitError, setSplitError] = useState('')
  const [splitSaving, setSplitSaving] = useState(false)
  const [splitForm, setSplitForm] = useState({
    current_label: 'متابعة الجزء الحالي',
    other_label: 'إكمال الجزء الآخر',
    current_expected_minutes: 5,
    other_expected_minutes: 5,
    other_assignee_id: '',
  })
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

  function startEditComment(item) {
    setEditingCommentId(item.id)
    setEditingCommentText(item.comment_text)
  }

  function cancelEditComment() {
    setEditingCommentId(null)
    setEditingCommentText('')
  }

  async function saveCommentEdit(event) {
    event.preventDefault()
    if (!editingCommentId || !editingCommentText.trim()) return
    await api(`/tasks/${taskId}/comments/${editingCommentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ comment_text: editingCommentText }),
    })
    cancelEditComment()
    load()
  }

  async function deleteComment(item) {
    if (!window.confirm('حذف هذه الملاحظة؟')) return
    await api(`/tasks/${taskId}/comments/${item.id}`, { method: 'DELETE' })
    if (editingCommentId === item.id) cancelEditComment()
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

  async function saveSelfCreatedApproval(approved) {
    const updatedTask = await api(`/tasks/${task.id}/self-created-approval`, {
      method: 'PATCH',
      body: JSON.stringify({ approved }),
    })
    setTask(updatedTask)
    window.dispatchEvent(new CustomEvent('team-tasks-refresh'))
  }

  async function openSplitForm() {
    setSplitError('')
    try {
      const users = await api(`/tasks/${task.id}/split-options`)
      const firstPart = Math.max(1, Math.ceil(task.expected_minutes / 2))
      const secondPart = Math.max(1, task.expected_minutes - firstPart)
      setSplitUsers(users)
      setSplitForm((current) => ({
        ...current,
        current_expected_minutes: firstPart,
        other_expected_minutes: secondPart,
        other_assignee_id: users[0]?.id || '',
      }))
      setSplitOpen(true)
    } catch (error) {
      setSplitError(error.message)
    }
  }

  async function submitSplit(event) {
    event.preventDefault()
    setSplitError('')
    setSplitSaving(true)
    try {
      const parts = await api(`/tasks/${task.id}/split`, {
        method: 'POST',
        body: JSON.stringify({
          ...splitForm,
          current_expected_minutes: Number(splitForm.current_expected_minutes),
          other_expected_minutes: Number(splitForm.other_expected_minutes),
          other_assignee_id: Number(splitForm.other_assignee_id),
        }),
      })
      setTask(parts[0])
      setSplitOpen(false)
      window.dispatchEvent(new CustomEvent('team-tasks-refresh'))
    } catch (error) {
      setSplitError(error.message)
    } finally {
      setSplitSaving(false)
    }
  }

  if (!task) return <div className="empty">جار التحميل...</div>
  const canReviewDelay = ['super_admin', 'admin', 'manager'].includes(user.role)
  const canDeleteTask = ['super_admin', 'admin', 'manager'].includes(user.role)
  const canFlagProductionIssue = canReviewDelay && task.status === 'done'
  const isEmployeeSelfCreated = task.created_by_user_id === task.assigned_to_user_id && task.assignee?.role === 'employee'
  const isFinance = task.department?.name_en?.trim().toLowerCase() === 'finance' || task.department?.name_ar === 'المالية'
  const canSplitTask = isFinance
    && !task.split_group_id
    && !['done', 'cancelled'].includes(task.status)
    && (user.role === 'super_admin' || (user.role === 'manager' && user.department_id === task.department_id) || user.id === task.assigned_to_user_id)
  return (
    <section>
      <div className="page-head">
        <h1>{task.title}</h1>
        <div className="actions">
          {user.role !== 'employee' && <button className="primary" onClick={() => editTask(task.id)}>تعديل مهمة</button>}
          {canSplitTask && <button type="button" className="split-task-button" onClick={openSplitForm}>تقسيم وإسناد المهمة</button>}
          {canDeleteTask && <button className="danger" onClick={deleteTask}>حذف المهمة</button>}
        </div>
      </div>
      {splitError && <div className="error">{splitError}</div>}
      {task.split_group_id && (
        <article className="panel split-task-summary">
          <strong>مهمة مقسمة: الجزء 1.{task.split_part} من 1.{task.split_total}</strong>
          <span>{task.split_label}</span>
        </article>
      )}
      {splitOpen && (
        <article className="panel split-task-panel">
          <div className="split-task-panel-head">
            <div>
              <h2>تقسيم المهمة بين موظفين</h2>
              <p>سيبقى الجزء 1.1 مع الموظف الحالي ووقته المسجل، وسيبدأ الجزء 1.2 كمهمة جديدة بانتظار التنفيذ.</p>
            </div>
            <button type="button" onClick={() => setSplitOpen(false)}>إلغاء</button>
          </div>
          <form className="split-task-form" onSubmit={submitSplit}>
            <fieldset>
              <legend>الجزء 1.1 - {task.assignee?.full_name_ar}</legend>
              <label>وصف الجزء<input required maxLength="120" value={splitForm.current_label} onChange={(event) => setSplitForm({ ...splitForm, current_label: event.target.value })} /></label>
              <label>الوقت المتوقع بالدقائق<input required min="1" type="number" value={splitForm.current_expected_minutes} onChange={(event) => setSplitForm({ ...splitForm, current_expected_minutes: event.target.value })} /></label>
            </fieldset>
            <fieldset>
              <legend>الجزء 1.2</legend>
              <label>وصف الجزء<input required maxLength="120" value={splitForm.other_label} onChange={(event) => setSplitForm({ ...splitForm, other_label: event.target.value })} /></label>
              <label>إسناد إلى
                <select required value={splitForm.other_assignee_id} onChange={(event) => setSplitForm({ ...splitForm, other_assignee_id: event.target.value })}>
                  {!splitUsers.length && <option value="">لا يوجد موظف آخر متاح</option>}
                  {splitUsers.map((member) => <option key={member.id} value={member.id}>{member.full_name_ar}</option>)}
                </select>
              </label>
              <label>الوقت المتوقع بالدقائق<input required min="1" type="number" value={splitForm.other_expected_minutes} onChange={(event) => setSplitForm({ ...splitForm, other_expected_minutes: event.target.value })} /></label>
            </fieldset>
            <button className="primary" disabled={splitSaving || !splitUsers.length}>{splitSaving ? 'جارٍ التقسيم...' : 'تأكيد التقسيم والإسناد'}</button>
          </form>
        </article>
      )}
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
      {isEmployeeSelfCreated && (
        <article className="panel self-approval-panel">
          <h2>اعتماد مهمة أضافها الموظف</h2>
          <p>{task.self_created_approved ? 'هذه المهمة معتمدة وتُحتسب في مؤشرات الأداء.' : 'هذه المهمة بانتظار اعتماد المدير قبل احتسابها في مؤشرات الأداء.'}</p>
          {canReviewDelay && (
            <div className="inline-form">
              {!task.self_created_approved && <button className="primary" type="button" onClick={() => saveSelfCreatedApproval(true)}>اعتماد المهمة</button>}
              {task.self_created_approved && <button type="button" onClick={() => saveSelfCreatedApproval(false)}>إلغاء الاعتماد</button>}
            </div>
          )}
        </article>
      )}
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
        {comments.map((item) => {
          const canManage = canManageComment(user, item)
          const isEditing = editingCommentId === item.id
          return (
            <div key={item.id} className="note comment-note">
              {isEditing ? (
                <form className="comment-edit-form" onSubmit={saveCommentEdit}>
                  <textarea value={editingCommentText} onChange={(event) => setEditingCommentText(event.target.value)} autoFocus />
                  <div className="comment-actions">
                    <button className="primary" type="submit">حفظ</button>
                    <button type="button" onClick={cancelEditComment}>إلغاء</button>
                  </div>
                </form>
              ) : (
                <>
                  <p>{item.comment_text}</p>
                  <small>{item.user?.full_name_ar} - {formatDateTime(item.created_at)}</small>
                  {canManage && (
                    <div className="comment-actions">
                      <button type="button" onClick={() => startEditComment(item)}>تعديل</button>
                      <button className="danger-subtle" type="button" onClick={() => deleteComment(item)}>حذف</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </article>
      <article className="panel">
        <h2>سجل الحالة</h2>
        {history.map((item) => <p key={item.id} className="note">{statusLabels[item.old_status] || '-'} ← {statusLabels[item.new_status]}{item.reason_text && <small>السبب: {item.reason_text}</small>}<small>{formatDateTime(item.changed_at)}</small></p>)}
      </article>
    </section>
  )
}

function canManageComment(user, comment) {
  if (!user || !comment) return false
  return comment.user_id === user.id || ['super_admin', 'admin', 'manager'].includes(user.role)
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
