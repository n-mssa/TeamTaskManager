import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, ClipboardPaste, Eye, FileSpreadsheet, History, ImageUp, Pencil, ShieldCheck, Trash2, X } from 'lucide-react'
import { API_BASE_URL, api, getToken } from '../api/client'

function localDateValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const sample = `مسؤول الزبون\tرقم امر العمل\tاسم العميل\tاسم المادة\tملاحظات
ابو عمر\t12777\tشركة الفخامة للتجارة والتطوير\tMK Cards & envelope\tملاحظة اختيارية`

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
  const [uploadingSanadId, setUploadingSanadId] = useState(null)
  const [editingHistoryId, setEditingHistoryId] = useState(null)
  const [savingHistoryId, setSavingHistoryId] = useState(null)
  const [deletingHistoryItem, setDeletingHistoryItem] = useState(null)
  const [deletionReason, setDeletionReason] = useState('')
  const [deletingHistoryId, setDeletingHistoryId] = useState(null)
  const [historyEdit, setHistoryEdit] = useState({ task_date: '', customer_rep: '', customer_name: '', material_name: '', note: '' })
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

  async function uploadSanad(item, selectedFiles) {
    const files = Array.from(selectedFiles || [])
    if (!files.length) return
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setHistoryError('يجب أن يكون السند صورة JPG أو PNG أو WEBP.')
      return
    }
    if (files.some((file) => file.size > 10 * 1024 * 1024)) {
      setHistoryError('يجب ألا يتجاوز حجم صورة السند 10 ميجابايت.')
      return
    }
    setUploadingSanadId(item.id)
    setHistoryError('')
    const formData = new FormData()
    files.forEach((file) => formData.append('sanad', file))
    try {
      const updated = await api(`/bills-import/${item.id}/sanad`, { method: 'POST', body: formData })
      setHistory((current) => current.map((row) => row.id === updated.id ? updated : row))
    } catch (err) {
      setHistoryError(err.message)
    } finally {
      setUploadingSanadId(null)
    }
  }

  async function viewSanad(item, sanad) {
    setHistoryError('')
    const previewWindow = window.open('', '_blank')
    if (previewWindow) previewWindow.opener = null
    try {
      const response = await fetch(`${API_BASE_URL}/bills-import/${item.id}/sanads/${sanad.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!response.ok) throw new Error('تعذر فتح صورة السند.')
      const objectUrl = URL.createObjectURL(await response.blob())
      if (previewWindow) previewWindow.location.href = objectUrl
      else {
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = sanad.original_filename || 'sanad'
        link.click()
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (err) {
      if (previewWindow) previewWindow.close()
      setHistoryError(err.message)
    }
  }

  function startHistoryEdit(item) {
    setHistoryError('')
    setEditingHistoryId(item.id)
    setHistoryEdit({
      task_date: item.task_date,
      customer_rep: item.customer_rep || '',
      customer_name: item.customer_name,
      material_name: item.material_name,
      note: item.note || '',
    })
  }

  function cancelHistoryEdit() {
    setEditingHistoryId(null)
    setHistoryEdit({ task_date: '', customer_rep: '', customer_name: '', material_name: '', note: '' })
  }

  async function saveHistoryEdit(item) {
    if (!historyEdit.task_date || !historyEdit.customer_name.trim() || !historyEdit.material_name.trim()) return
    setSavingHistoryId(item.id)
    setHistoryError('')
    try {
      const updated = await api(`/bills-import/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify(historyEdit),
      })
      setHistory((current) => current.map((row) => row.id === updated.id ? updated : row))
      cancelHistoryEdit()
    } catch (err) {
      setHistoryError(err.message)
    } finally {
      setSavingHistoryId(null)
    }
  }

  function openHistoryDelete(item) {
    setHistoryError('')
    setDeletingHistoryItem(item)
    setDeletionReason('')
  }

  function cancelHistoryDelete() {
    if (deletingHistoryId) return
    setDeletingHistoryItem(null)
    setDeletionReason('')
  }

  async function deleteHistoryItem(event) {
    event.preventDefault()
    const reason = deletionReason.trim()
    if (!deletingHistoryItem || !reason) return
    setDeletingHistoryId(deletingHistoryItem.id)
    setHistoryError('')
    try {
      await api(`/bills-import/${deletingHistoryItem.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      })
      setHistory((current) => current.filter((item) => item.id !== deletingHistoryItem.id))
      setDeletingHistoryItem(null)
      setDeletionReason('')
    } catch (err) {
      setHistoryError(err.message)
    } finally {
      setDeletingHistoryId(null)
    }
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
          <div><strong>تنسيق الأعمدة المطلوب</strong><span>مسؤول الزبون، رقم أمر العمل، اسم العميل، اسم المادة، ملاحظات (اختياري). يجب أن يحتوي كل صف على رقم أمر عمل. للأكياس السادة التي لا تملك رقم أمر عمل، استخدمي الرقم 0.</span></div>
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
              <thead><tr><th>الصفوف</th><th>الحالة</th><th>عنوان المهمة</th><th>مسؤول الزبون</th><th>ملاحظات المهمة</th><th>نتيجة الفحص</th></tr></thead>
              <tbody>{preview.rows.map((row) => (
                <tr key={`${row.row_number}-${row.work_order_id}`} className={`bills-row-${row.status}`}>
                  <td>{row.row_count > 1 ? `${row.row_count} صفوف` : row.row_number}</td>
                  <td><span className={`bills-row-status ${row.status}`}>{statusLabel(row.status)}</span></td>
                  <td>
                    <strong>{row.title || `${row.work_order_id} - ${row.customer_name} - ${row.material_name}`}</strong>
                    {row.row_count > 1 && <small className="bills-group-details">{row.work_order_id}<br />{row.material_name}</small>}
                  </td>
                  <td>{row.customer_rep || '-'}</td>
                  <td>{row.note || '-'}</td>
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
              <thead><tr><th>رقم أمر العمل</th><th>اسم العميل</th><th>اسم المادة</th><th>مسؤول الزبون</th><th>ملاحظات</th><th>تاريخ المهمة</th><th>الحالة</th><th className="bills-sanad-column">السند</th><th>وقت الرفع</th><th className="bills-actions-column">الإجراءات</th></tr></thead>
              <tbody>{history.map((item) => {
                const isEditing = editingHistoryId === item.id
                return <tr key={item.id} className={isEditing ? 'bills-history-editing' : ''}>
                <td><strong>{item.work_order_id}</strong></td>
                <td>{isEditing ? <input aria-label="اسم العميل" value={historyEdit.customer_name} onChange={(event) => setHistoryEdit({ ...historyEdit, customer_name: event.target.value })} /> : item.customer_name}</td>
                <td>{isEditing ? <input aria-label="اسم المادة" value={historyEdit.material_name} onChange={(event) => setHistoryEdit({ ...historyEdit, material_name: event.target.value })} /> : item.material_name}</td>
                <td>{isEditing ? <input aria-label="مسؤول الزبون" value={historyEdit.customer_rep} onChange={(event) => setHistoryEdit({ ...historyEdit, customer_rep: event.target.value })} /> : item.customer_rep || '-'}</td>
                <td className="bills-note-cell">{isEditing ? <textarea aria-label="ملاحظات المهمة" maxLength="2000" value={historyEdit.note} onChange={(event) => setHistoryEdit({ ...historyEdit, note: event.target.value })} /> : item.note || '-'}</td>
                <td>{isEditing ? <input aria-label="تاريخ المهمة" type="date" value={historyEdit.task_date} onChange={(event) => setHistoryEdit({ ...historyEdit, task_date: event.target.value })} /> : item.task_date}</td>
                <td><span className={`badge status-${item.status}`}>{taskStatusLabel(item.status)}</span></td>
                <td className="bills-sanad-column"><div className="sanad-actions">
                  {(item.sanads || []).map((sanad, index) => (
                    <button key={sanad.id} type="button" className="sanad-view-button" title={sanad.original_filename} onClick={() => viewSanad(item, sanad)}>
                      <Eye size={14} />سند {index + 1}
                    </button>
                  ))}
                  <label className={`sanad-upload-button ${item.has_sanad ? 'replace' : ''}`}>
                    <ImageUp size={14} />{uploadingSanadId === item.id ? 'جارٍ الرفع...' : item.has_sanad ? 'إضافة سند' : 'إرفاق سند'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      disabled={uploadingSanadId !== null}
                      onChange={(event) => {
                        uploadSanad(item, event.target.files)
                        event.target.value = ''
                      }}
                    />
                  </label>
                  {item.has_sanad && <small>{(item.sanads || []).length} سند مرفق</small>}
                </div></td>
                <td>{formatDateTime(item.created_at)}</td>
                <td className="bills-actions-column"><div className="bills-history-edit-actions">
                  {isEditing ? <>
                    <button type="button" className="save" disabled={savingHistoryId === item.id} onClick={() => saveHistoryEdit(item)}><Check size={15} />{savingHistoryId === item.id ? 'جارٍ الحفظ...' : 'حفظ'}</button>
                    <button type="button" className="cancel" disabled={savingHistoryId === item.id} onClick={cancelHistoryEdit}><X size={15} />إلغاء</button>
                  </> : <>
                    <button type="button" className="icon-button" aria-label="تعديل المهمة" title="تعديل الأسماء والتاريخ والملاحظات" onClick={() => startHistoryEdit(item)}><Pencil size={15} /></button>
                    <button type="button" className="icon-button bills-history-delete" aria-label="حذف المهمة" title="حذف المهمة" onClick={() => openHistoryDelete(item)}><Trash2 size={15} /></button>
                  </>}
                </div></td>
              </tr>
              })}</tbody>
            </table></div>
          ) : <div className="empty-state"><span className="empty-state-icon"><History size={21} /></span><strong>لا توجد عمليات رفع سابقة</strong><span>ستظهر المهام هنا بعد تأكيد أول دفعة.</span></div>}
        </article>
      )}
      {deletingHistoryItem && (
        <div className="modal-backdrop" role="presentation" onClick={cancelHistoryDelete}>
          <form className="briefing-modal bills-delete-modal" role="dialog" aria-modal="true" aria-labelledby="bills-delete-title" onSubmit={deleteHistoryItem} onClick={(event) => event.stopPropagation()}>
            <header className="briefing-head">
              <div><p className="eyebrow">حذف مهمة فاتورة</p><h2 id="bills-delete-title">لماذا تريدين حذف هذه المهمة؟</h2></div>
              <button className="icon-button" type="button" onClick={cancelHistoryDelete} aria-label="إغلاق"><X size={17} /></button>
            </header>
            <p className="bills-delete-task-title">{deletingHistoryItem.title}</p>
            <label>سبب الحذف
              <textarea required autoFocus maxLength="1000" value={deletionReason} onChange={(event) => setDeletionReason(event.target.value)} placeholder="اكتبي سبب الحذف ليصل إلى مدير قسم المالية..." />
            </label>
            <p className="bills-delete-note">سيتم إخفاء المهمة وإرسال إشعار إلى مدير قسم المالية مع السبب.</p>
            <div className="modal-actions">
              <button type="button" disabled={Boolean(deletingHistoryId)} onClick={cancelHistoryDelete}>إلغاء</button>
              <button className="danger" type="submit" disabled={Boolean(deletingHistoryId) || !deletionReason.trim()}><Trash2 size={16} />{deletingHistoryId ? 'جارٍ الحذف...' : 'تأكيد الحذف'}</button>
            </div>
          </form>
        </div>
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
