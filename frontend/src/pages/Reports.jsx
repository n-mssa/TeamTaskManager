import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { statusLabels } from '../utils/labels'

const summaryLabels = {
  created_this_week: 'المهام المنشأة هذا الأسبوع',
  completed_this_week: 'المهام المنجزة هذا الأسبوع',
  pending: 'بانتظار التنفيذ',
  in_progress: 'قيد التنفيذ',
  delayed: 'المهام المتأخرة',
  completed_late: 'المهام المنجزة متأخرة',
  expected_minutes: 'إجمالي الوقت المتوقع بالدقائق',
}

export default function Reports() {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [report, setReport] = useState(null)

  async function load() {
    const params = new URLSearchParams()
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    setReport(await api(`/reports/weekly${params.toString() ? `?${params}` : ''}`))
  }

  useEffect(() => { load() }, [])

  function exportCsv() {
    const rows = [...(report?.completed_tasks || []), ...(report?.pending_in_progress_tasks || []), ...(report?.delayed_tasks || [])]
    const csv = ['المهمة,المكلف,القسم,الحالة,الوقت المتوقع,تاريخ التسليم,تاريخ الإنجاز,هل تأخرت']
      .concat(rows.map((row) => [row.title, row.assignee, row.department, statusLabels[row.status] || row.status, row.expected_minutes, row.due_date, row.completed_at || '', row.is_late ? 'نعم' : 'لا'].join(',')))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'weekly-report.csv'
    link.click()
  }

  if (!report) return <div className="empty">جار التحميل...</div>
  return (
    <section>
      <div className="page-head">
        <h1>التقارير الأسبوعية</h1>
        <div className="actions"><button onClick={() => window.print()}>طباعة</button><button onClick={exportCsv}>تصدير CSV</button></div>
      </div>
      <div className="filters">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <button onClick={load}>تحديث التقرير</button>
      </div>
      <div className="stats">
        {Object.entries(report.summary).map(([key, value]) => <div key={key}><strong>{value}</strong><span>{summaryLabels[key] || key}</span></div>)}
      </div>
      <ReportTable title="المهام المنجزة" rows={report.completed_tasks} />
      <ReportTable title="بانتظار التنفيذ / قيد التنفيذ" rows={report.pending_in_progress_tasks} />
      <ReportTable title="المهام المتأخرة" rows={report.delayed_tasks} />
    </section>
  )
}

function ReportTable({ title, rows }) {
  return (
    <article className="panel">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table><thead><tr><th>المهمة</th><th>المكلف</th><th>القسم</th><th>الحالة</th><th>تاريخ التسليم</th><th>تاريخ الإنجاز</th><th>هل تأخرت؟</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={`${title}-${row.id}`}><td>{row.title}</td><td>{row.assignee}</td><td>{row.department}</td><td>{statusLabels[row.status] || row.status}</td><td>{row.due_date}</td><td>{row.completed_at || '-'}</td><td>{row.is_late || row.is_overdue ? 'نعم' : 'لا'}</td></tr>)}</tbody>
        </table>
      </div>
    </article>
  )
}
