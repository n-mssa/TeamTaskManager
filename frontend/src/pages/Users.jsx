import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { roleLabels } from '../utils/labels'

export default function Users() {
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [form, setForm] = useState({ username: '', password: '', full_name_ar: '', role: 'employee', department_id: '', is_active: true })
  const [error, setError] = useState('')

  async function load() {
    const [nextUsers, nextDepartments] = await Promise.all([api('/users'), api('/departments')])
    setUsers(nextUsers)
    setDepartments(nextDepartments)
  }

  useEffect(() => { load() }, [])

  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, department_id: form.department_id ? Number(form.department_id) : null }),
      })
      setForm({ username: '', password: '', full_name_ar: '', role: 'employee', department_id: '', is_active: true })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function deactivate(id) {
    await api(`/users/${id}/deactivate`, { method: 'PATCH' })
    load()
  }

  return (
    <section>
      <div className="page-head"><h1>المستخدمون</h1></div>
      <form className="form-grid" onSubmit={submit}>
        <label>اسم المستخدم<input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
        <label>كلمة المرور<input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <label>الاسم العربي<input required value={form.full_name_ar} onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })} /></label>
        <label>الدور<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>القسم<select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}><option value="">بدون</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}</select></label>
        {error && <p className="error">{error}</p>}
        <button className="primary">إنشاء مستخدم</button>
      </form>
      <div className="table-wrap"><table><thead><tr><th>اسم المستخدم</th><th>الاسم العربي</th><th>الدور</th><th>القسم</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{users.map((user) => <tr key={user.id}><td>{user.username}</td><td>{user.full_name_ar}</td><td>{roleLabels[user.role]}</td><td>{departments.find((d) => d.id === user.department_id)?.name_ar || '-'}</td><td>{user.is_active ? 'فعال' : 'غير فعال'}</td><td><button onClick={() => deactivate(user.id)}>تعطيل</button></td></tr>)}</tbody>
      </table></div>
    </section>
  )
}
