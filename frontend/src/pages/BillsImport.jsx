import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ClipboardPaste, FileSpreadsheet, History, ShieldCheck } from 'lucide-react'
import { api } from '../api/client'

function localDateValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const sample = `مسؤول الزبون\tرقم امر العمل\tاسم العميل\tاسم المادة
ابو عمر\t12777\tشركة الفخامة للتجارة والتطوير\tMK Cards & envelope`

export default function BillsImport() {
  const [activeTab, setActiveTab] = useState('upload')
  const [pastedText, setPastedText] = useState('')
  const [taskDate, setTaskDate] = useState(localDateValue())
  const [expectedMinutes, setExpectedMinutes] = useState(10)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const readyRows = useMemo(() => preview?.rows?.filter((row) => row.status === 'ready') || [], [preview])

  useEffect(() => { loadHistory() }, [])

  async function loadHistory() {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      setHistory(await api('/bills-import/history'))
    } catch (err) {
      setHistoryError(err.message)
    } finally {
      setHistoryLoading(false)
    }
  }

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
      loadHistory()
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

      <div className="bills-workspace-tabs" aria-label="أقسام إدخال الفواتير">
        <button type="button" className={activeTab === 'upload' ? 'active' : ''} onClick={() => setActiveTab('upload')}><ClipboardPaste size={17} />رفع مهام جديدة</button>
        <button type="button" className={activeTab === 'history' ? 'active' : ''} onClick={() => { setActiveTab('history'); loadHistory() }}><History size={17} />السجل السابق <span>{history.length}</span></button>
      </div>

      {activeTab === 'upload' && <>
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
      </>}

      {activeTab === 'history' && (
        <article className="panel bills-history-panel">
          <header className="bills-history-head"><div><p className="eyebrow">السجل السابق</p><h2>المهام التي رفعتها سابقاً</h2></div><button type="button" onClick={loadHistory} disabled={historyLoading}>تحديث</button></header>
          {historyError && <p className="error">{historyError}</p>}
          {historyLoading ? <div className="empty-state compact">جارٍ تحميل السجل...</div> : history.length ? (
            <div className="table-wrap bills-history-table"><table>
              <thead><tr><th>رقم أمر العمل</th><th>اسم العميل</th><th>اسم المادة</th><th>مسؤول الزبون</th><th>تاريخ المهمة</th><th>الحالة</th><th>وقت الرفع</th></tr></thead>
              <tbody>{history.map((item) => <tr key={item.id}>
                <td><strong>{item.work_order_id}</strong></td>
                <td>{item.customer_name}</td>
                <td>{item.material_name}</td>
                <td>{item.customer_rep || '-'}</td>
                <td>{item.task_date}</td>
                <td><span className={`badge status-${item.status}`}>{taskStatusLabel(item.status)}</span></td>
                <td>{formatDateTime(item.created_at)}</td>
              </tr>)}</tbody>
            </table></div>
          ) : <div className="empty-state"><span className="empty-state-icon"><History size={21} /></span><strong>لا توجد عمليات رفع سابقة</strong><span>ستظهر المهام هنا بعد تأكيد أول دفعة.</span></div>}
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

function taskStatusLabel(status) {
  return {
    pending: 'بانتظار التنفيذ',
    in_progress: 'قيد التنفيذ',
    blocked: 'متوقف',
    done: 'منجز',
    cancelled: 'ملغي',
    delayed: 'متأخر',
  }[status] || status
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('ar-JO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
