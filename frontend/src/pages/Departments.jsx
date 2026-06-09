import { useEffect, useState } from 'react'
import { api } from '../api/client'

export default function Departments() {
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ name_ar: '', name_en: '', manager_id: '' })

  async function load() {
    setDepartments(await api('/departments'))
    setUsers(await api('/users?active_only=true'))
  }

  useEffect(() => { load() }, [])

  async function submit(event) {
    event.preventDefault()
    await api('/departments', {
      method: 'POST',
      body: JSON.stringify({ name_ar: form.name_ar, name_en: form.name_en || null, manager_id: form.manager_id ? Number(form.manager_id) : null }),
    })
    setForm({ name_ar: '', name_en: '', manager_id: '' })
    load()
  }

  return (
    <section>
      <div className="page-head"><h1>الأقسام</h1></div>
      <form className="form-grid" onSubmit={submit}>
        <label>اسم القسم بالعربية<input required value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></label>
        <label>اسم القسم بالإنجليزية<input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></label>
        <label>المدير<select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}><option value="">بدون</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name_ar}</option>)}</select></label>
        <button className="primary">إنشاء قسم</button>
      </form>
      <div className="table-wrap"><table><thead><tr><th>القسم</th><th>English</th><th>المدير</th></tr></thead>
        <tbody>{departments.map((item) => <tr key={item.id}><td>{item.name_ar}</td><td>{item.name_en || '-'}</td><td>{users.find((user) => user.id === item.manager_id)?.full_name_ar || '-'}</td></tr>)}</tbody>
      </table></div>
    </section>
  )
}
