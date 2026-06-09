import { useEffect, useState } from 'react'
import { api } from '../api/client'

export default function DelayReasons() {
  const [reasons, setReasons] = useState([])
  const [name, setName] = useState('')

  async function load() {
    setReasons(await api('/delay-reasons?active_only=false'))
  }

  useEffect(() => { load() }, [])

  async function submit(event) {
    event.preventDefault()
    await api('/delay-reasons', { method: 'POST', body: JSON.stringify({ name_ar: name, is_active: true }) })
    setName('')
    load()
  }

  async function deactivate(id) {
    await api(`/delay-reasons/${id}/deactivate`, { method: 'PATCH' })
    load()
  }

  return (
    <section>
      <div className="page-head"><h1>أسباب التأخير</h1></div>
      <form className="inline-form" onSubmit={submit}>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="سبب التأخير" />
        <button className="primary">إضافة</button>
      </form>
      <div className="table-wrap"><table><thead><tr><th>السبب</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{reasons.map((item) => <tr key={item.id}><td>{item.name_ar}</td><td>{item.is_active ? 'فعال' : 'غير فعال'}</td><td><button onClick={() => deactivate(item.id)}>تعطيل</button></td></tr>)}</tbody>
      </table></div>
    </section>
  )
}
