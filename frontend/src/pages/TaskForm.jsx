import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { priorityOptions } from '../utils/labels'

const maxAttachments = 3
const maxAttachmentBytes = 10 * 1024 * 1024
const financeTitleTemplates = {
  invoice: 'اصدار فاتورة',
  receipt: 'سند قبض',
}

function localDateValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

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
  recurrence_frequency: 'none',
  recurrence_start_date: localDateValue(),
  finance_title_template: '',
  finance_title_detail: '',
}

export default function TaskForm({ taskId, onSaved, user }) {
  const [form, setForm] = useState(emptyTask)
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [delayReasons, setDelayReasons] = useState([])
  const [attachments, setAttachments] = useState([])
  const [recurringTemplates, setRecurringTemplates] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const filteredUsers = useMemo(() => {
    if (user?.role === 'employee') return users.filter((item) => item.id === user.id)
    if (!form.department_id) return []
    return users.filter((item) => String(item.department_id || '') === String(form.department_id))
  }, [form.department_id, user, users])
  const selectedDepartment = useMemo(
    () => departments.find((item) => String(item.id) === String(form.department_id)),
    [departments, form.department_id],
  )
  const isFinanceDepartment = selectedDepartment?.name_ar === 'المالية'
    || selectedDepartment?.name_en?.trim().toLowerCase() === 'finance'
  const canCreateRecurring = !taskId
    && selectedDepartment?.recurring_tasks_enabled
    && (user?.role === 'super_admin' || user?.role === 'manager')

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

  useEffect(() => {
    if (!canCreateRecurring) {
      setRecurringTemplates([])
      if (form.recurrence_frequency !== 'none') setValue('recurrence_frequency', 'none')
      return
    }
    api('/recurring-tasks')
      .then((items) => setRecurringTemplates(items.filter((item) => String(item.department_id) === String(form.department_id))))
      .catch(() => setRecurringTemplates([]))
  }, [canCreateRecurring, form.department_id])

  function setValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function chooseDepartment(value) {
    const department = departments.find((item) => String(item.id) === String(value))
    const isFinance = department?.name_ar === 'المالية' || department?.name_en?.trim().toLowerCase() === 'finance'
    setForm((current) => ({
      ...current,
      department_id: value,
      finance_title_template: isFinance ? current.finance_title_template : '',
      finance_title_detail: isFinance ? current.finance_title_detail : '',
      title: !isFinance && current.finance_title_template ? '' : current.title,
    }))
  }

  function chooseFinanceTemplate(value) {
    setForm((current) => ({
      ...current,
      finance_title_template: value,
      finance_title_detail: '',
      title: '',
    }))
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
    const financePrefix = financeTitleTemplates[form.finance_title_template]
    const taskTitle = financePrefix
      ? `${financePrefix} - ${form.finance_title_detail.trim()}`
      : form.title.trim()
    if (!taskTitle || (financePrefix && !form.finance_title_detail.trim())) {
      setError('يرجى إدخال اسم المهمة.')
      setSaving(false)
      return
    }
    const payload = {
      title: taskTitle,
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
      if (!taskId && form.recurrence_frequency !== 'none') {
        await api('/recurring-tasks', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            frequency: form.recurrence_frequency,
            start_date: form.recurrence_start_date,
          }),
        })
        onSaved()
        return
      }
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

  async function toggleRecurringTemplate(template) {
    setError('')
    try {
      const updated = await api(`/recurring-tasks/${template.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !template.is_active }),
      })
      setRecurringTemplates((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section>
      <div className="page-head"><h1>{taskId ? 'تعديل مهمة' : 'إنشاء مهمة'}</h1></div>
      <form className="form-grid" onSubmit={submit}>
        <label>القسم<select required value={form.department_id} onChange={(e) => chooseDepartment(e.target.value)} disabled={user?.role === 'employee'}>
          <option value="">اختر القسم</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}
        </select></label>
        {!taskId && isFinanceDepartment && <label>نوع المهمة المالية<select value={form.finance_title_template} onChange={(e) => chooseFinanceTemplate(e.target.value)}>
          <option value="">مهمة عادية</option>
          <option value="invoice">اصدار فاتورة</option>
          <option value="receipt">سند قبض</option>
        </select></label>}
        {form.finance_title_template && !taskId ? (
          <label>اسم المهمة
            <div className="finance-title-control" dir="rtl">
              <span>{financeTitleTemplates[form.finance_title_template]}</span>
              <input
                required
                autoFocus
                maxLength={220 - financeTitleTemplates[form.finance_title_template].length - 3}
                value={form.finance_title_detail}
                onChange={(e) => setValue('finance_title_detail', e.target.value)}
                placeholder="اكتب اسم العميل أو تفاصيل المهمة"
              />
            </div>
            <small>سيُحفظ العنوان: {financeTitleTemplates[form.finance_title_template]} - {form.finance_title_detail || 'اسم المهمة'}</small>
          </label>
        ) : <label>عنوان المهمة<input required value={form.title} onChange={(e) => setValue('title', e.target.value)} /></label>}
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
        {canCreateRecurring && (
          <div className="recurrence-panel span-2">
            <div className="recurrence-panel-head">
              <div><strong>تكرار مهمة المالية</strong><small>يتم إنشاء المهمة تلقائياً الساعة 8:00 صباحاً بتوقيت عمّان.</small></div>
              <select value={form.recurrence_frequency} onChange={(e) => setValue('recurrence_frequency', e.target.value)}>
                <option value="none">مرة واحدة فقط</option>
                <option value="daily">يومياً ما عدا الجمعة</option>
                <option value="monthly">شهرياً</option>
              </select>
            </div>
            {form.recurrence_frequency !== 'none' && (
              <label>تاريخ أول إضافة
                <input type="date" required min={localDateValue()} value={form.recurrence_start_date} onChange={(e) => setValue('recurrence_start_date', e.target.value)} />
                <small>{form.recurrence_frequency === 'monthly' ? 'سيتم التكرار في نفس رقم اليوم من كل شهر.' : 'لن تُنشأ مهام أيام الجمعة.'}</small>
              </label>
            )}
          </div>
        )}
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
        {!taskId && form.recurrence_frequency === 'none' && (
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
      {canCreateRecurring && recurringTemplates.length > 0 && (
        <article className="panel recurring-template-list">
          <h2>المهام الدورية للقسم</h2>
          <div className="table-wrap"><table><thead><tr><th>المهمة</th><th>المكلف</th><th>التكرار</th><th>تاريخ البداية</th><th>الحالة</th><th>الإجراء</th></tr></thead>
            <tbody>{recurringTemplates.map((template) => <tr key={template.id}><td>{template.title}</td><td>{template.assignee?.full_name_ar || '-'}</td><td>{template.frequency === 'daily' ? 'يومي ما عدا الجمعة' : `شهري - يوم ${template.monthly_day}`}</td><td>{template.start_date}</td><td><span className={`badge ${template.is_active ? 'status-done' : 'status-cancelled'}`}>{template.is_active ? 'فعال' : 'متوقف'}</span></td><td><button type="button" onClick={() => toggleRecurringTemplate(template)}>{template.is_active ? 'إيقاف التكرار' : 'إعادة التفعيل'}</button></td></tr>)}</tbody>
          </table></div>
        </article>
      )}
    </section>
  )
}
