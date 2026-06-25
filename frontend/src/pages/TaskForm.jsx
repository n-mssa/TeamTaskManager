import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { priorityOptions, statusOptions } from '../utils/labels'

const maxAttachments = 3
const maxAttachmentBytes = 10 * 1024 * 1024

const emptyTask = {
  title: '',
  description: '',
  department_id: '',
  assigned_to_user_id: '',
  priority: 'normal',
  status: 'pending',
  expected_hours: 1,
  expected_minutes_part: 0,
  due_date: '',
  manager_notes: '',
  hold_reason_text: '',
  overrun_reason_text: '',
}

export default function TaskForm({ taskId, onSaved }) {
  const [form, setForm] = useState(emptyTask)
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [delayReasons, setDelayReasons] = useState([])
  const [attachments, setAttachments] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    const requests = [
      api('/users?active_only=true'),
      api('/departments'),
      api('/delay-reasons'),
      taskId ? api(`/tasks/${taskId}`) : Promise.resolve(null),
    ]
    Promise.all(requests).then(([nextUsers, nextDepartments, nextDelayReasons, task]) => {
      setUsers(nextUsers)
      setDepartments(nextDepartments)
      setDelayReasons(nextDelayReasons)
      if (task) setForm({
        ...task,
        expected_hours: Math.floor(task.expected_minutes / 60),
        expected_minutes_part: task.expected_minutes % 60,
        due_date: task.due_date,
      })
    })
  }, [taskId])

  function setValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function chooseAttachments(event) {
    const files = Array.from(event.target.files || [])
    if (files.length > maxAttachments) {
      setError('يمكنك رفع 3 ملفات كحد أقصى.')
      event.target.value = ''
      setAttachments([])
      return
    }
    const oversized = files.find((file) => file.size > maxAttachmentBytes)
    if (oversized) {
      setError('يجب أن يكون حجم كل ملف 10 ميجابايت أو أقل.')
      event.target.value = ''
      setAttachments([])
      return
    }
    setError('')
    setAttachments(files)
  }

  function appendPayload(formData, payload) {
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== null && value !== undefined) formData.append(key, value)
    })
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    const payload = {
      title: form.title,
      description: form.description || null,
      department_id: Number(form.department_id),
      assigned_to_user_id: Number(form.assigned_to_user_id),
      priority: form.priority,
      status: form.status,
      expected_minutes: Number(form.expected_hours || 0) * 60 + Number(form.expected_minutes_part || 0),
      due_date: form.due_date,
      delay_reason_id: form.delay_reason_id ? Number(form.delay_reason_id) : null,
      delay_reason_text: form.delay_reason_text || null,
      hold_reason_text: form.hold_reason_text || null,
      overrun_reason_text: form.overrun_reason_text || null,
      manager_notes: form.manager_notes || null,
    }
    try {
      if (!taskId && attachments.length) {
        const formData = new FormData()
        appendPayload(formData, payload)
        attachments.forEach((file) => formData.append('attachments', file))
        await api('/tasks/with-attachments', {
          method: 'POST',
          body: formData,
        })
        onSaved()
        return
      }
      await api(taskId ? `/tasks/${taskId}` : '/tasks', {
        method: taskId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section>
      <div className="page-head"><h1>{taskId ? 'تعديل مهمة' : 'إنشاء مهمة'}</h1></div>
      <form className="form-grid" onSubmit={submit}>
        <label>عنوان المهمة<input required value={form.title} onChange={(e) => setValue('title', e.target.value)} /></label>
        <label>القسم<select required value={form.department_id} onChange={(e) => setValue('department_id', e.target.value)}>
          <option value="">اختر القسم</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}
        </select></label>
        <label>المكلف<select required value={form.assigned_to_user_id} onChange={(e) => setValue('assigned_to_user_id', e.target.value)}>
          <option value="">اختر الموظف</option>{users.map((item) => <option key={item.id} value={item.id}>{item.full_name_ar}</option>)}
        </select></label>
        <label>الأولوية<select value={form.priority} onChange={(e) => setValue('priority', e.target.value)}>{priorityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>الحالة<select value={form.status} onChange={(e) => setValue('status', e.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>تاريخ التسليم<input required type="date" value={form.due_date} onChange={(e) => setValue('due_date', e.target.value)} /></label>
        <label>ساعات متوقعة<input type="number" min="0" value={form.expected_hours} onChange={(e) => setValue('expected_hours', e.target.value)} /></label>
        <label>دقائق<input type="number" min="0" max="59" value={form.expected_minutes_part} onChange={(e) => setValue('expected_minutes_part', e.target.value)} /></label>
        <label className="span-2">الوصف<textarea value={form.description || ''} onChange={(e) => setValue('description', e.target.value)} /></label>
        <label>سبب التأخير<select value={form.delay_reason_id || ''} onChange={(e) => setValue('delay_reason_id', e.target.value)}>
          <option value="">بدون</option>{delayReasons.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}
        </select></label>
        <label>شرح السبب<input value={form.delay_reason_text || ''} onChange={(e) => setValue('delay_reason_text', e.target.value)} /></label>
        {form.status === 'blocked' && <label className="span-2">سبب الانتظار<textarea required value={form.hold_reason_text || ''} onChange={(e) => setValue('hold_reason_text', e.target.value)} /></label>}
        <label className="span-2">سبب تجاوز الوقت المتوقع<textarea value={form.overrun_reason_text || ''} onChange={(e) => setValue('overrun_reason_text', e.target.value)} /></label>
        <label className="span-2">ملاحظات المدير<textarea value={form.manager_notes || ''} onChange={(e) => setValue('manager_notes', e.target.value)} /></label>
        {!taskId && (
          <label className="span-2 file-upload">
            المرفقات
            <input type="file" multiple onChange={chooseAttachments} />
            <small>حتى 3 ملفات، 10 ميجابايت لكل ملف.</small>
            {attachments.length > 0 && <span>{attachments.map((file) => file.name).join(', ')}</span>}
          </label>
        )}
        {error && <p className="error span-2">{error}</p>}
        <button className="primary span-2">حفظ</button>
      </form>
    </section>
  )
}
