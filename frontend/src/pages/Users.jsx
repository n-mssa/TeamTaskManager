import { useEffect, useState } from 'react'
import { KeyRound, Pencil, X } from 'lucide-react'
import { api } from '../api/client'
import { roleLabels } from '../utils/labels'

export default function Users() {
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [form, setForm] = useState({ username: '', password: '', full_name_ar: '', role: 'employee', department_id: '', is_active: true })
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [passwordUser, setPasswordUser] = useState(null)
  const [newPassword, setNewPassword] = useState('')

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
    try {
      await api(`/users/${id}/deactivate`, { method: 'PATCH' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function saveUser(event) {
    event.preventDefault()
    setError('')
    try {
      await api(`/users/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          username: editing.username,
          full_name_ar: editing.full_name_ar,
          role: editing.role,
          department_id: editing.department_id ? Number(editing.department_id) : null,
          is_active: editing.is_active,
        }),
      })
      setEditing(null)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function resetPassword(event) {
    event.preventDefault()
    setError('')
    try {
      await api(`/users/${passwordUser.id}/reset-password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: newPassword }),
      })
      setPasswordUser(null)
      setNewPassword('')
    } catch (err) {
      setError(err.message)
    }
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
      <div className="table-wrap"><table><thead><tr><th>اسم المستخدم</th><th>الاسم العربي</th><th>الدور</th><th>القسم</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
        <tbody>{users.map((user) => <tr key={user.id}><td>{user.username}</td><td>{user.full_name_ar}</td><td>{roleLabels[user.role]}</td><td>{departments.find((d) => d.id === user.department_id)?.name_ar || '-'}</td><td><span className={`badge ${user.is_active ? 'status-done' : 'status-cancelled'}`}>{user.is_active ? 'فعال' : 'غير فعال'}</span></td><td><div className="row-actions"><button onClick={() => { setError(''); setEditing({ ...user, department_id: user.department_id || '' }) }}><Pencil size={15} /> تعديل</button><button onClick={() => { setError(''); setPasswordUser(user); setNewPassword('') }}><KeyRound size={15} /> كلمة المرور</button>{user.is_active && <button className="danger-subtle" onClick={() => deactivate(user.id)}>تعطيل</button>}</div></td></tr>)}</tbody>
      </table></div>
      {editing && <UserEditModal user={editing} departments={departments} error={error} onChange={setEditing} onClose={() => setEditing(null)} onSubmit={saveUser} />}
      {passwordUser && <PasswordModal user={passwordUser} password={newPassword} error={error} setPassword={setNewPassword} onClose={() => { setPasswordUser(null); setNewPassword('') }} onSubmit={resetPassword} />}
    </section>
  )
}

function UserEditModal({ user, departments, error, onChange, onClose, onSubmit }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="briefing-modal user-modal" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head"><div><p className="eyebrow">إدارة المستخدم</p><h2>تعديل بيانات وصلاحيات المستخدم</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></header>
        <div className="modal-form-grid">
          <label>اسم المستخدم<input required value={user.username} onChange={(e) => onChange({ ...user, username: e.target.value })} /></label>
          <label>الاسم العربي<input required value={user.full_name_ar} onChange={(e) => onChange({ ...user, full_name_ar: e.target.value })} /></label>
          <label>الدور<select value={user.role} onChange={(e) => onChange({ ...user, role: e.target.value })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>القسم<select value={user.department_id} onChange={(e) => onChange({ ...user, department_id: e.target.value })}><option value="">بدون</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}</select></label>
          <label className="toggle-label"><input type="checkbox" checked={user.is_active} onChange={(e) => onChange({ ...user, is_active: e.target.checked })} /> الحساب فعال</label>
        </div>
        {error && <p className="error">{error}</p>}
        <footer className="briefing-actions"><button type="button" onClick={onClose}>إلغاء</button><button className="primary">حفظ التغييرات</button></footer>
      </form>
    </div>
  )
}

function PasswordModal({ user, password, error, setPassword, onClose, onSubmit }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="briefing-modal user-modal password-modal" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}>
        <header className="briefing-head"><div><p className="eyebrow">{user.full_name_ar}</p><h2>إعادة تعيين كلمة المرور</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></header>
        <label>كلمة المرور الجديدة<input autoFocus required minLength="4" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <small>يجب أن تتكون كلمة المرور من 4 أحرف على الأقل.</small>
        {error && <p className="error">{error}</p>}
        <footer className="briefing-actions"><button type="button" onClick={onClose}>إلغاء</button><button className="primary">تعيين كلمة المرور</button></footer>
      </form>
    </div>
  )
}
