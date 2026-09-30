import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardPaste, FileSpreadsheet, ShieldCheck } from 'lucide-react'
import { api } from '../api/client'

function localDateValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const sample = `مسؤول الزبون\tرقم امر العمل\tاسم العميل\tاسم المادة
ابو عمر\t12777\tشركة الفخامة للتجارة والتطوير\tMK Cards & envelope`

export default function BillsImport() {
  const [pastedText, setPastedText] = useState('')
  const [taskDate, setTaskDate] = useState(localDateValue())
  const [expectedMinutes, setExpectedMinutes] = useState(30)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const readyRows = useMemo(() => preview?.rows?.filter((row) => row.status === 'ready') || [], [preview])

  function payload() {
    return {
      pasted_text: pastedText,
      task_date: taskDate,
      expected_minutes: Number(expectedMinutes),
    }
  }

  async function inspect(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      setPreview(await api('/bills-import/preview', { method: 'POST', body: JSON.stringify(payload()) }))
    } catch (err) {
      setPreview(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function confirmImport() {
    if (!readyRows.length || preview.invalid_count) return
    setLoading(true)
    setError('')
    try {
      setPreview(await api('/bills-import/commit', { method: 'POST', body: JSON.stringify(payload()) }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function updateText(value) {
    setPastedText(value)
    setPreview(null)
    setError('')
  }

  return (
    <section className="bills-import-page">
      <div className="bills-hero">
        <span className="bills-hero-icon"><FileSpreadsheet size={24} /></span>
        <div>
          <p className="eyebrow">قسم المالية</p>
          <h1>إضافة مهام الفواتير</h1>
          <p>الصقي الصفوف من Excel، راجعي المهام، ثم أكدي إضافتها دفعة واحدة.</p>
        </div>
      </div>

      <form className="bills-import-form" onSubmit={inspect}>
        <div className="bills-import-guide">
          <ClipboardPaste size={20} />
          <div><strong>تنسيق الأعمدة المطلوب</strong><span>مسؤول الزبون، رقم أمر العمل، اسم العميل، اسم المادة. يجب أن يحتوي كل صف على رقم أمر عمل.</span></div>
        </div>
        <label className="bills-paste-field">الصق البيانات هنا
          <textarea
            required
            dir="rtl"
            value={pastedText}
            onChange={(event) => updateText(event.target.value)}
            placeholder={sample}
          />
        </label>
        <div className="bills-batch-options">
          <label>تاريخ المهام<input type="date" required value={taskDate} onChange={(event) => { setTaskDate(event.target.value); setPreview(null) }} /></label>
          <label>الوقت المتوقع لكل مهمة بالدقائق<input type="number" min="1" max="1440" required value={expectedMinutes} onChange={(event) => { setExpectedMinutes(event.target.value); setPreview(null) }} /></label>
          <button className="primary" disabled={loading}>{loading ? 'جارٍ الفحص...' : 'معاينة المهام'}</button>
        </div>
      </form>

      {error && <p className="error bills-import-error">{error}</p>}

      {preview && (
        <article className="panel bills-preview">
          <header className="bills-preview-head">
            <div><p className="eyebrow">المعاينة قبل الحفظ</p><h2>ستُسند المهام إلى {preview.assignee_name}</h2><span>القسم: {preview.department_name}</span></div>
            <div className="bills-summary">
              <span className="ready">جاهز: {preview.ready_count}</span>
              <span className="duplicate">مكرر: {preview.duplicate_count}</span>
              <span className="invalid">يحتاج تصحيحاً: {preview.invalid_count}</span>
            </div>
          </header>
          {preview.created_count > 0 && (
            <div className="bills-success"><CheckCircle2 size={20} /><strong>تم إنشاء {preview.created_count} مهمة وإسنادها بنجاح.</strong></div>
          )}
          <div className="table-wrap bills-preview-table">
            <table>
              <thead><tr><th>الصف</th><th>الحالة</th><th>عنوان المهمة</th><th>مسؤول الزبون</th><th>ملاحظة</th></tr></thead>
              <tbody>{preview.rows.map((row) => (
                <tr key={`${row.row_number}-${row.work_order_id}`} className={`bills-row-${row.status}`}>
                  <td>{row.row_number}</td>
                  <td><span className={`bills-row-status ${row.status}`}>{statusLabel(row.status)}</span></td>
                  <td>{row.title || `${row.work_order_id} - ${row.customer_name} - ${row.material_name}`}</td>
                  <td>{row.customer_rep || '-'}</td>
                  <td>{row.message || '-'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {preview.created_count === 0 && (
            <footer className="bills-confirm-bar">
              <div><ShieldCheck size={20} /><span>{preview.invalid_count ? 'صححي الصفوف المعلّمة ثم أعيدي المعاينة.' : `سيتم إنشاء ${preview.ready_count} مهمة فقط، ولن تُكرر الصفوف المضافة سابقاً.`}</span></div>
              <button type="button" className="primary" disabled={loading || !readyRows.length || preview.invalid_count > 0} onClick={confirmImport}>
                {loading ? 'جارٍ الإنشاء...' : `تأكيد إنشاء ${preview.ready_count} مهمة`}
              </button>
            </footer>
          )}
        </article>
      )}
    </section>
  )
}

function statusLabel(status) {
  return {
    ready: 'جاهز',
    duplicate: 'مكرر',
    invalid: 'غير مكتمل',
    created: 'تم الإنشاء',
  }[status] || status
}
