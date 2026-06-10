import { useState } from 'react'
import { CheckSquare } from 'lucide-react'
import { api, setToken } from '../api/client'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const token = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setToken(token.access_token)
      const me = await api('/auth/me')
      onLogin(me)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <form className="login-box" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark"><CheckSquare size={19} /></span>
          <div><strong>لوحة المهام</strong><span>إدارة مهام الفريق</span></div>
        </div>
        <h1>تسجيل الدخول</h1>
        <p className="login-intro">أدخل بياناتك للوصول إلى مساحة العمل.</p>
        <label>
          اسم المستخدم
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          كلمة المرور
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={loading}>{loading ? 'جار التحقق...' : 'دخول'}</button>
      </form>
    </main>
  )
}
