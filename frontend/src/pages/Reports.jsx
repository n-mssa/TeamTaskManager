import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { statusLabels } from '../utils/labels'
import EmptyState from '../components/EmptyState'

const summaryLabels = {
  created_this_week: 'المهام المنشأة هذا الأسبوع',
  completed_this_week: 'المهام المنجزة هذا الأسبوع',
  pending: 'بانتظار التنفيذ',
  in_progress: 'قيد التنفيذ',
  delayed: 'المهام المتأخرة',
  completed_late: 'المهام المنجزة متأخرة',
  expected_minutes: 'إجمالي الوقت المتوقع بالدقائق',
}

export default function Reports({ user }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [userId, setUserId] = useState('')
  const [users, setUsers] = useState([])
  const [report, setReport] = useState(null)
  const canFilterUsers = user?.role === 'admin' || user?.role === 'manager'
  const displayedReport = useMemo(() => filterReportByUser(report, userId), [report, userId])

  async function load() {
    const params = new URLSearchParams()
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    if (userId) params.set('user_id', userId)
    const nextReport = await api(`/reports/weekly${params.toString() ? `?${params}` : ''}`)
    setReport(nextReport)
    if (Array.isArray(nextReport.available_users)) setUsers(nextReport.available_users)
  }

  useEffect(() => {
    if (!canFilterUsers) return
    api('/users?active_only=true').then(setUsers).catch(() => setUsers([]))
  }, [canFilterUsers])

  useEffect(() => { load() }, [startDate, endDate, userId])

  function exportCsv() {
    const rows = [...(displayedReport?.completed_tasks || []), ...(displayedReport?.pending_in_progress_tasks || []), ...(displayedReport?.delayed_tasks || [])]
    const csv = ['المهمة,المكلف,القسم,الحالة,الوقت المتوقع,تاريخ الإسناد,تاريخ الإنجاز,هل تجاوزت الوقت المتوقع']
      .concat(rows.map((row) => [row.title, row.assignee, row.department, statusLabels[row.status] || row.status, row.expected_minutes, row.assigned_date || row.due_date, row.completed_at || '', row.is_late ? 'نعم' : 'لا'].join(',')))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    const selectedUser = users.find((item) => String(item.id) === String(userId))
    link.download = selectedUser ? `weekly-report-${selectedUser.username}.csv` : 'weekly-report.csv'
    link.click()
  }

  if (!displayedReport) return <div className="empty">جار التحميل...</div>
  return (
    <section>
      <div className="page-head">
        <h1>التقارير الأسبوعية</h1>
        <div className="actions"><button onClick={() => window.print()}>طباعة</button><button onClick={exportCsv}>تصدير CSV</button></div>
      </div>
      <div className="filters">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        {canFilterUsers && (
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">كل المستخدمين</option>
            {users.map((item) => <option key={item.id} value={item.id}>{item.full_name_ar}</option>)}
          </select>
        )}
        <button onClick={load}>تحديث التقرير</button>
      </div>
      <div className="stats">
        {Object.entries(displayedReport.summary).map(([key, value]) => <div key={key}><strong>{value}</strong><span>{summaryLabels[key] || key}</span></div>)}
      </div>
      <ReportCharts report={displayedReport} />
      <ReportTable title="المهام المنجزة" rows={displayedReport.completed_tasks} />
      <ReportTable title="بانتظار التنفيذ / قيد التنفيذ" rows={displayedReport.pending_in_progress_tasks} />
      <ReportTable title="المهام المتأخرة" rows={displayedReport.delayed_tasks} />
    </section>
  )
}

function filterReportByUser(report, userId) {
  if (!report || !userId) return report
  const selectedId = Number(userId)
  const selectedUser = report.available_users?.find((item) => Number(item.id) === selectedId)
  const belongsToSelected = (row) => {
    if (row.assignee_id) return Number(row.assignee_id) === selectedId
    return selectedUser ? row.assignee === selectedUser.full_name_ar : true
  }
  const completedTasks = (report.completed_tasks || []).filter(belongsToSelected)
  const pendingInProgressTasks = (report.pending_in_progress_tasks || []).filter(belongsToSelected)
  const delayedTasks = (report.delayed_tasks || []).filter(belongsToSelected)
  const visibleRows = [...completedTasks, ...pendingInProgressTasks, ...delayedTasks]
  const employeeSummary = summarizeRowsByEmployee(visibleRows)

  return {
    ...report,
    completed_tasks: completedTasks,
    pending_in_progress_tasks: pendingInProgressTasks,
    delayed_tasks: delayedTasks,
    by_employee: employeeSummary,
    summary: {
      ...report.summary,
      completed_this_week: completedTasks.length,
      pending: visibleRows.filter((row) => row.status === 'pending').length,
      in_progress: visibleRows.filter((row) => row.status === 'in_progress').length,
      delayed: delayedTasks.length,
      completed_late: completedTasks.filter((row) => row.is_late || row.is_overdue).length,
      expected_minutes: visibleRows.reduce((total, row) => total + (Number(row.expected_minutes) || 0), 0),
    },
  }
}

function ReportCharts({ report }) {
  const statusData = [
    { label: 'بانتظار التنفيذ', value: report.summary.pending || 0, color: '#f59e0b' },
    { label: 'قيد التنفيذ', value: report.summary.in_progress || 0, color: '#2563eb' },
    { label: 'منجزة', value: report.summary.completed_this_week || 0, color: '#10b981' },
    { label: 'تجاوزت الوقت', value: report.summary.delayed || 0, color: '#ef4444' },
  ].filter((item) => item.value > 0)
  const employeeData = (report.by_employee || []).slice(0, 8).map((item) => ({
    label: item.employee,
    value: (item.done || 0) + (item.in_progress || 0) + (item.pending || 0) + (item.delayed || 0),
  })).filter((item) => item.value > 0)
  const delayData = (report.delay_reasons || []).slice(0, 6).map((item) => ({ label: item.reason, value: item.count || 0 })).filter((item) => item.value > 0)

  return (
    <div className="report-charts">
      <article className="panel chart-card">
        <h2>توزيع الحالات</h2>
        <PieChart data={statusData} />
      </article>
      <article className="panel chart-card">
        <h2>المهام حسب الموظف</h2>
        <BarChart data={employeeData} />
      </article>
      <article className="panel chart-card">
        <h2>أسباب تجاوز الوقت</h2>
        <BarChart data={delayData} />
      </article>
    </div>
  )
}

function PieChart({ data }) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  if (!total) return <EmptyState compact title="لا توجد بيانات للرسم" description="ستظهر الرسوم عند توفر مهام ضمن التقرير." />
  let offset = 25
  return (
    <div className="pie-chart-wrap">
      <svg className="pie-chart" viewBox="0 0 42 42" role="img" aria-label="توزيع الحالات">
        <circle className="pie-hole" cx="21" cy="21" r="15.915" />
        {data.map((item) => {
          const dash = (item.value / total) * 100
          const segment = <circle key={item.label} cx="21" cy="21" r="15.915" fill="transparent" stroke={item.color} strokeWidth="8" strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={offset} />
          offset -= dash
          return segment
        })}
      </svg>
      <div className="chart-legend">
        {data.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}: {item.value}</span>)}
      </div>
    </div>
  )
}

function BarChart({ data }) {
  const max = Math.max(...data.map((item) => item.value), 0)
  if (!max) return <EmptyState compact title="لا توجد بيانات للرسم" description="ستظهر الأعمدة عند توفر بيانات كافية." />
  return (
    <div className="bar-chart">
      {data.map((item) => (
        <div className="bar-row" key={item.label}>
          <span>{item.label}</span>
          <div><i style={{ width: `${Math.max(8, (item.value / max) * 100)}%` }} /></div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  )
}

function summarizeRowsByEmployee(rows) {
  const grouped = new Map()
  rows.forEach((row) => {
    const current = grouped.get(row.assignee) || { employee: row.assignee, done: 0, in_progress: 0, pending: 0, delayed: 0, expected_minutes: 0 }
    if (row.status === 'done') current.done += 1
    if (row.status === 'in_progress') current.in_progress += 1
    if (row.status === 'pending') current.pending += 1
    if (row.is_late || row.is_overdue) current.delayed += 1
    current.expected_minutes += Number(row.expected_minutes) || 0
    grouped.set(row.assignee, current)
  })
  return Array.from(grouped.values())
}

function ReportTable({ title, rows }) {
  return (
    <article className="panel">
      <h2>{title}<small>{rows.length} مهمة</small></h2>
      {rows.length
        ? <div className="table-wrap">
          <table><thead><tr><th>المهمة</th><th>المكلف</th><th>القسم</th><th>الحالة</th><th>تاريخ الإسناد</th><th>تاريخ الإنجاز</th><th>تجاوزت الوقت؟</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={`${title}-${row.id}`}><td>{row.title}</td><td>{row.assignee}</td><td>{row.department}</td><td>{statusLabels[row.status] || row.status}</td><td>{row.assigned_date || row.due_date}</td><td>{row.completed_at || '-'}</td><td>{row.is_late || row.is_overdue ? 'نعم' : 'لا'}</td></tr>)}</tbody>
          </table>
        </div>
        : <EmptyState compact title="لا توجد مهام في هذا القسم" description="ستظهر المهام هنا عند توفر بيانات ضمن الفترة المحددة." />}
    </article>
  )
}
