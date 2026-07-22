import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { priorityOptions } from '../utils/labels'

const maxAttachments = 3
const maxAttachmentBytes = 10 * 1024 * 1024

function formatTimePart(value) {
  return String(Number(value || 0)).padStart(2, '0')
}

const emptyTask = {
  title: '',
  description: '',
  department_id: '',
  assigned_to_user_id: '',
  priority: 'normal',
  status: 'pending',
  expected_hours: '01',
  expected_minutes_part: '00',
  manager_notes: '',
  hold_reason_text: '',
  overrun_reason_text: '',
}

export default function TaskForm({ taskId, onSaved, user }) {
  const [form, setForm] = useState(emptyTask)
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [delayReasons, setDelayReasons] = useState([])
  const [attachments, setAttachments] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const filteredUsers = useMemo(() => {
    if (user?.role === 'employee') return users.filter((item) => item.id === user.id)
    if (!form.department_id) return []
    return users.filter((item) => String(item.department_id || '') === String(form.department_id))
  }, [form.department_id, user, users])

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
        expected_hours: formatTimePart(Math.floor(task.expected_minutes / 60)),
        expected_minutes_part: formatTimePart(task.expected_minutes % 60),
      })
      if (!task && user?.role === 'employee') {
        setForm((current) => ({
          ...current,
          department_id: user.department_id ? String(user.department_id) : '',
          assigned_to_user_id: String(user.id),
        }))
      }
    })
  }, [taskId, user])

  useEffect(() => {
    if (taskId || form.department_id || departments.length !== 1) return
    setValue('department_id', String(departments[0].id))
  }, [departments, form.department_id, taskId])

  useEffect(() => {
    if (!form.assigned_to_user_id) return
    const assigneeStillAvailable = filteredUsers.some((item) => String(item.id) === String(form.assigned_to_user_id))
    if (!assigneeStillAvailable) setValue('assigned_to_user_id', '')
  }, [filteredUsers, form.assigned_to_user_id])

  function setValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function setTimePart(key, value, max) {
    const digits = value.replace(/\D/g, '').slice(0, 2)
    if (digits === '') {
      setValue(key, '')
      return
    }
    setValue(key, String(Math.min(max, Number(digits))))
  }

  function blurTimePart(key, max) {
    setForm((current) => ({
      ...current,
      [key]: formatTimePart(Math.min(max, Number(current[key] || 0))),
    }))
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
    if (saving) return
    setSaving(true)
    setError('')
    const expectedMinutes = Number(form.expected_hours || 0) * 60 + Number(form.expected_minutes_part || 0)
    if (expectedMinutes <= 0) {
      setError('الوقت المتوقع يجب أن يكون أكبر من صفر.')
      setSaving(false)
      return
    }
    const payload = {
      title: form.title,
      description: form.description || null,
      department_id: Number(form.department_id),
      assigned_to_user_id: Number(form.assigned_to_user_id),
      priority: form.priority,
      expected_minutes: expectedMinutes,
      delay_reason_id: taskId && form.delay_reason_id ? Number(form.delay_reason_id) : null,
      delay_reason_text: taskId ? form.delay_reason_text || null : null,
      hold_reason_text: form.hold_reason_text || null,
      overrun_reason_text: taskId ? form.overrun_reason_text || null : null,
      manager_notes: form.manager_notes || null,
    }
    if (!taskId) payload.status = 'pending'
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
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="page-head"><h1>{taskId ? 'تعديل مهمة' : 'إنشاء مهمة'}</h1></div>
      <form className="form-grid" onSubmit={submit}>
        <label>عنوان المهمة<input required value={form.title} onChange={(e) => setValue('title', e.target.value)} /></label>
        <label>القسم<select required value={form.department_id} onChange={(e) => setValue('department_id', e.target.value)} disabled={user?.role === 'employee'}>
          <option value="">اختر القسم</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}
        </select></label>
        <label>المكلف<select required value={form.assigned_to_user_id} onChange={(e) => setValue('assigned_to_user_id', e.target.value)} disabled={!form.department_id || user?.role === 'employee'}>
          <option value="">{form.department_id ? 'اختر الموظف' : 'اختر القسم أولاً'}</option>{filteredUsers.map((item) => <option key={item.id} value={item.id}>{item.full_name_ar}</option>)}
        </select></label>
        <label>الأولوية<select value={form.priority} onChange={(e) => setValue('priority', e.target.value)}>{priorityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="expected-time-field">الوقت المتوقع
          <div className="expected-time-control" dir="ltr">
            <input
              aria-label="ساعات"
              inputMode="numeric"
              maxLength="2"
              value={form.expected_hours}
              onChange={(e) => setTimePart('expected_hours', e.target.value, 99)}
              onBlur={() => blurTimePart('expected_hours', 99)}
            />
            <span>:</span>
            <input
              aria-label="دقائق"
              inputMode="numeric"
              maxLength="2"
              value={form.expected_minutes_part}
              onChange={(e) => setTimePart('expected_minutes_part', e.target.value, 59)}
              onBlur={() => blurTimePart('expected_minutes_part', 59)}
            />
          </div>
          <small>دقائق : ساعات</small>
        </label>
        <label className="span-2">الوصف<textarea value={form.description || ''} onChange={(e) => setValue('description', e.target.value)} /></label>
        {taskId && <>
          <label>سبب التأخير<select value={form.delay_reason_id || ''} onChange={(e) => setValue('delay_reason_id', e.target.value)}>
            <option value="">بدون</option>{delayReasons.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}
          </select></label>
          <label>شرح السبب<input value={form.delay_reason_text || ''} onChange={(e) => setValue('delay_reason_text', e.target.value)} /></label>
        </>}
        {form.status === 'blocked' && <label className="span-2">سبب الانتظار<textarea required value={form.hold_reason_text || ''} onChange={(e) => setValue('hold_reason_text', e.target.value)} /></label>}
        {taskId && <label className="span-2">سبب تجاوز الوقت المتوقع<textarea value={form.overrun_reason_text || ''} onChange={(e) => setValue('overrun_reason_text', e.target.value)} /></label>}
        {user?.role !== 'employee' && <label className="span-2">ملاحظات المدير<textarea value={form.manager_notes || ''} onChange={(e) => setValue('manager_notes', e.target.value)} /></label>}
        {user?.role === 'employee' && !taskId && <p className="note span-2">ستظهر هذه المهمة عندك مباشرة، لكنها لن تُحتسب في مؤشرات الأداء حتى يعتمدها المدير.</p>}
        {!taskId && (
          <label className="span-2 file-upload">
            المرفقات
            <input type="file" multiple onChange={chooseAttachments} />
            <small>حتى 3 ملفات، 10 ميجابايت لكل ملف.</small>
            {attachments.length > 0 && <span>{attachments.map((file) => file.name).join(', ')}</span>}
          </label>
        )}
        {error && <p className="error span-2">{error}</p>}
        <button className="primary span-2" disabled={saving}>{saving ? 'جار الحفظ...' : 'حفظ'}</button>
      </form>
    </section>
  )
}
