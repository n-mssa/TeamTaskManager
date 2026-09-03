import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import EmptyState from '../components/EmptyState'

const summaryLabels = {
  created_this_week: 'المهام المنجزة ضمن الفترة',
  completed_this_week: 'المهام المنجزة',
  pending: 'بانتظار التنفيذ',
  in_progress: 'قيد التنفيذ',
  blocked: 'متوقف',
  delayed: 'المهام المتأخرة',
  completed_late: 'المهام المنجزة متأخرة',
  expected_minutes: 'إجمالي الوقت المتوقع بالدقائق',
}

export default function Reports({ user, openTask, executive = false }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [userId, setUserId] = useState('')
  const [users, setUsers] = useState([])
  const [report, setReport] = useState(null)
  const canFilterUsers = user?.role === 'admin' || user?.role === 'manager'
  const canViewExecutiveReport = user?.role === 'admin' && String(user?.username || '').toLowerCase() === 'admin'
  const displayedReport = useMemo(() => filterReportByUser(report, userId), [report, userId])
  const reportRangeTitle = displayedReport ? `تقرير من ${formatDateOnly(displayedReport.start_date)} إلى ${formatDateOnly(displayedReport.end_date)}` : (executive ? 'تقرير الإدارة التنفيذي' : 'التقارير')
  const generatedAt = useMemo(() => new Date(), [displayedReport?.start_date, displayedReport?.end_date, userId])
  const selectedUser = users.find((item) => String(item.id) === String(userId))

  async function load() {
    if (executive && !canViewExecutiveReport) return
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

  useEffect(() => { load() }, [startDate, endDate, userId, executive, canViewExecutiveReport])

  function exportCsv() {
    const rows = [...(displayedReport?.completed_tasks || []), ...(displayedReport?.pending_in_progress_tasks || []), ...(displayedReport?.delayed_tasks || [])]
    const header = executive
      ? 'المهمة,الوقت المتوقع,تاريخ الإسناد,تاريخ الإنجاز,هل تجاوزت الوقت المتوقع,مدة التجاوز'
      : 'المهمة,المكلف,الوقت المتوقع,تاريخ الإسناد,تاريخ الإنجاز,هل تجاوزت الوقت المتوقع,مدة التجاوز,الملاحظات'
    const csv = [header]
      .concat(rows.map((row) => (
        executive
          ? [row.title, row.expected_minutes, formatDateOnly(row.assigned_date || row.due_date), formatDateTime(row.completed_at), row.is_late || row.is_overdue ? 'نعم' : 'لا', formatOverrun(row)]
          : [row.title, row.assignee, row.expected_minutes, formatDateOnly(row.assigned_date || row.due_date), formatDateTime(row.completed_at), row.is_late || row.is_overdue ? 'نعم' : 'لا', formatOverrun(row), formatComments(row.comments)]
      ).map(csvCell).join(',')))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    const selectedUser = users.find((item) => String(item.id) === String(userId))
    const range = displayedReport ? `${displayedReport.start_date}-to-${displayedReport.end_date}` : 'report'
    link.download = selectedUser ? `report-${range}-${selectedUser.username}.csv` : `report-${range}.csv`
    link.click()
  }

  if (executive && !canViewExecutiveReport) {
    return <EmptyState title="غير مصرح" description="هذا التقرير متاح لحساب مدير النظام الرئيسي فقط." />
  }
  if (!displayedReport) return <div className="empty">جار التحميل...</div>
  return (
    <section className={`reports-page${executive ? ' executive-report-page' : ''}`}>
      <div className="page-head screen-only">
        <h1>{executive ? `تقرير الإدارة التنفيذي من ${formatDateOnly(displayedReport.start_date)} إلى ${formatDateOnly(displayedReport.end_date)}` : reportRangeTitle}</h1>
        <div className="actions"><button onClick={() => window.print()}>طباعة</button><button onClick={exportCsv}>تصدير CSV</button></div>
      </div>
      <ReportPrintHeader report={displayedReport} generatedAt={generatedAt} selectedUser={selectedUser} executive={executive} />
      <div className="filters screen-only">
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
      <div className="stats report-summary">
        {Object.entries(displayedReport.summary).map(([key, value]) => <div key={key}><strong>{value}</strong><span>{summaryLabels[key] || key}</span></div>)}
      </div>
      <ReportCharts report={displayedReport} hideDelayReasons={executive} />
      <div className="report-detail-sections">
        <ReportTable title="المهام المنجزة" rows={displayedReport.completed_tasks} onOpenTask={openTask} executive={executive} />
        <ReportTable title="بانتظار التنفيذ / قيد التنفيذ / متوقف" rows={displayedReport.pending_in_progress_tasks} onOpenTask={openTask} executive={executive} />
        <ReportTable title="المهام المتأخرة" rows={displayedReport.delayed_tasks} onOpenTask={openTask} executive={executive} />
      </div>
    </section>
  )
}

function ReportPrintHeader({ report, generatedAt, selectedUser, executive }) {
  return (
    <header className="report-print-header print-only">
      <div>
        <p>لوحة المهام</p>
        <h1>{executive ? 'تقرير الإدارة التنفيذي' : 'تقرير إدارة المهام'}</h1>
      </div>
      <dl>
        <div><dt>الفترة</dt><dd dir="ltr">{formatDateOnly(report.start_date)} - {formatDateOnly(report.end_date)}</dd></div>
        <div><dt>تاريخ الإصدار</dt><dd dir="ltr">{formatDateTime(generatedAt)}</dd></div>
        <div><dt>الموظف</dt><dd dir="auto">{selectedUser ? selectedUser.full_name_ar : 'كل المستخدمين'}</dd></div>
      </dl>
    </header>
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
      created_this_week: completedTasks.length,
      completed_this_week: completedTasks.length,
      pending: visibleRows.filter((row) => row.status === 'pending').length,
      in_progress: visibleRows.filter((row) => row.status === 'in_progress').length,
      blocked: visibleRows.filter((row) => row.status === 'blocked').length,
      delayed: delayedTasks.length,
      completed_late: completedTasks.filter((row) => row.is_late || row.is_overdue).length,
      expected_minutes: visibleRows.reduce((total, row) => total + (Number(row.expected_minutes) || 0), 0),
    },
  }
}

function ReportCharts({ report, hideDelayReasons = false }) {
  const statusData = [
    { label: 'بانتظار التنفيذ', value: report.summary.pending || 0, color: '#f59e0b' },
    { label: 'قيد التنفيذ', value: report.summary.in_progress || 0, color: '#2563eb' },
    { label: 'متوقف', value: report.summary.blocked || 0, color: '#64748b' },
    { label: 'منجزة', value: report.summary.completed_this_week || 0, color: '#10b981' },
    { label: 'تجاوزت الوقت', value: report.summary.delayed || 0, color: '#ef4444' },
  ].filter((item) => item.value > 0)
  const employeeData = (report.by_employee || []).slice(0, 8).map((item) => ({
    label: item.employee,
    value: (item.done || 0) + (item.in_progress || 0) + (item.pending || 0) + (item.blocked || 0) + (item.delayed || 0),
  })).filter((item) => item.value > 0)
  const delayData = (report.delay_reasons || []).slice(0, 6).map((item) => ({ label: item.reason, value: item.count || 0 })).filter((item) => item.value > 0)

  return (
    <div className="report-charts">
      <article className="panel chart-card report-section">
        <h2>توزيع الحالات</h2>
        <PieChart data={statusData} />
      </article>
      <article className="panel chart-card report-section report-chart-print-hidden">
        <h2>المهام حسب الموظف</h2>
        <BarChart data={employeeData} />
      </article>
      {!hideDelayReasons && (
        <article className="panel chart-card report-section">
          <h2>أسباب تجاوز الوقت</h2>
          <BarChart data={delayData} />
        </article>
      )}
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
    const current = grouped.get(row.assignee) || { employee: row.assignee, done: 0, in_progress: 0, pending: 0, blocked: 0, delayed: 0, expected_minutes: 0 }
    if (row.status === 'done') current.done += 1
    if (row.status === 'in_progress') current.in_progress += 1
    if (row.status === 'pending') current.pending += 1
    if (row.status === 'blocked') current.blocked += 1
    if (row.is_late || row.is_overdue) current.delayed += 1
    current.expected_minutes += Number(row.expected_minutes) || 0
    grouped.set(row.assignee, current)
  })
  return Array.from(grouped.values())
}

function ReportTable({ title, rows, onOpenTask, executive = false }) {
  return (
    <article className="panel report-section report-table-section">
      <h2>{title}<small>{rows.length} مهمة</small></h2>
      {rows.length
        ? <div className="table-wrap">
          <table className="report-table"><thead><tr><th scope="col">المهمة</th>{!executive && <th scope="col">المكلف</th>}<th scope="col">الوقت المتوقع</th><th scope="col">تاريخ الإسناد</th><th scope="col">تاريخ الإنجاز</th><th scope="col">تجاوزت الوقت؟</th><th scope="col">مدة التجاوز</th>{!executive && <th scope="col">الملاحظات</th>}</tr></thead>
            <tbody>{rows.map((row) => (
              <tr
                key={`${title}-${row.id}`}
                className={onOpenTask ? 'clickable-row' : ''}
                onClick={() => onOpenTask?.(row.id)}
                tabIndex={onOpenTask ? 0 : undefined}
                onKeyDown={(event) => {
                  if (!onOpenTask) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpenTask(row.id)
                  }
                }}
                title={onOpenTask ? 'فتح تفاصيل المهمة' : undefined}
              >
                <td><span dir="auto">{row.title}</span></td>
                {!executive && <td><span dir="auto">{row.assignee}</span></td>}
                <td><span dir="ltr">{row.expected_minutes}</span></td>
                <td><span dir="ltr">{formatDateOnly(row.assigned_date || row.due_date)}</span></td>
                <td><span dir="ltr">{formatDateTime(row.completed_at)}</span></td>
                <td>{row.is_late || row.is_overdue ? 'نعم' : 'لا'}</td>
                <td><span dir="ltr">{formatOverrun(row)}</span></td>
                {!executive && <td><span dir="auto">{formatComments(row.comments)}</span></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
        : <EmptyState compact title="لا توجد مهام في هذا الجدول" description="ستظهر المهام هنا عند توفر بيانات ضمن الفترة المحددة." />}
    </article>
  )
}

function formatOverrun(row) {
  const delayHours = Number(row.delay_hours) || 0
  if (delayHours <= 0) return '-'
  const totalMinutes = Math.round(delayHours * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours && minutes) return `${hours}س ${minutes}د`
  if (hours) return `${hours}س`
  return `${minutes}د`
}

function formatComments(comments = []) {
  if (!Array.isArray(comments) || !comments.length) return '-'
  return comments.map((comment) => {
    const meta = [comment.user, formatDateTime(comment.created_at)].filter(Boolean).join(' - ')
    return meta ? `${meta}: ${comment.comment_text}` : comment.comment_text
  }).join(' | ')
}

function csvCell(value) {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function formatDateOnly(value) {
  if (!value) return '-'
  const [year, month, day] = String(value).slice(0, 10).split('-')
  if (!year || !month || !day) return value
  return `${month}/${day}/${year}`
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Amman',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((current, part) => {
    current[part.type] = part.value
    return current
  }, {})
  return `${parts.month}/${parts.day}/${String(parts.year).slice(-2)} ${parts.hour}:${parts.minute}`
}
