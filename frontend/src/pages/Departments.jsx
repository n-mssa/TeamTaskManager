import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { api } from '../api/client'

export default function Departments({ user }) {
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ name_ar: '', name_en: '', is_restricted: false })
  const [updatingId, setUpdatingId] = useState(null)
  const [error, setError] = useState('')
  const isSuperAdmin = user?.role === 'super_admin'

  async function load() {
    const [nextDepartments, nextUsers] = await Promise.all([api('/departments'), api('/users?active_only=true')])
    setDepartments(nextDepartments)
    setUsers(nextUsers)
  }

  useEffect(() => { load() }, [])

  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      await api('/departments', {
        method: 'POST',
        body: JSON.stringify({ name_ar: form.name_ar, name_en: form.name_en || null, manager_id: null, is_restricted: isSuperAdmin && form.is_restricted }),
      })
      setForm({ name_ar: '', name_en: '', is_restricted: false })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleProtection(department) {
    const nextRestricted = !department.is_restricted
    if (!nextRestricted && !window.confirm('هل أنت متأكد من إزالة الحماية عن هذا القسم؟ سيصبح مرئياً لجميع مديري النظام.')) return
    setUpdatingId(department.id)
    setError('')
    try {
      const updated = await api(`/departments/${department.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name_ar: department.name_ar,
          name_en: department.name_en || null,
          manager_id: department.manager_id || null,
          is_restricted: nextRestricted,
        }),
      })
      setDepartments((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (err) {
      setError(err.message)
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <section>
      <div className="page-head"><h1>الأقسام</h1></div>
      <form className="form-grid" onSubmit={submit}>
        <label>اسم القسم بالعربية<input required value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></label>
        <label>اسم القسم بالإنجليزية<input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></label>
        {isSuperAdmin && <label className="toggle-label"><input type="checkbox" checked={form.is_restricted} onChange={(e) => setForm({ ...form, is_restricted: e.target.checked })} /> قسم محمي (للمدير والسوبر أدمن فقط)</label>}
        <p className="note">أنشئ القسم أولاً، ثم أنشئ مستخدماً بدور مدير واختر هذا القسم. سيتم ربطه كمدير القسم تلقائياً.</p>
        {error && <p className="error">{error}</p>}
        <button className="primary">إنشاء قسم</button>
      </form>
      <div className="table-wrap"><table><thead><tr><th>القسم</th><th>الاسم بالإنجليزية</th><th>المدير</th>{isSuperAdmin && <><th>الخصوصية</th><th>الإجراء</th></>}</tr></thead>
        <tbody>{departments.map((item) => <tr key={item.id}><td>{item.name_ar}</td><td>{item.name_en || '-'}</td><td>{users.find((user) => user.id === item.manager_id)?.full_name_ar || '-'}</td>{isSuperAdmin && <><td><span className={`badge ${item.is_restricted ? 'status-blocked' : 'status-done'}`}>{item.is_restricted ? 'محمي' : 'عادي'}</span></td><td><div className="row-actions"><button type="button" disabled={updatingId === item.id} className={item.is_restricted ? 'danger-subtle' : ''} onClick={() => toggleProtection(item)}>{item.is_restricted ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}{updatingId === item.id ? 'جارٍ الحفظ...' : item.is_restricted ? 'إزالة الحماية' : 'تعيين كمحمي'}</button></div></td></>}</tr>)}</tbody>
      </table></div>
    </section>
  )
}
