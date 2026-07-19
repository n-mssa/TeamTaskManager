import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import EmptyState from '../components/EmptyState'

export default function Kpi({ user, openTask }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [userId, setUserId] = useState('')
  const [users, setUsers] = useState([])
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const canFilterUsers = user?.role === 'admin' || user?.role === 'manager'
  const displayedReport = useMemo(() => filterReportByUser(report, userId), [report, userId])

  async function load() {
    const params = new URLSearchParams()
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    if (userId) params.set('user_id', userId)
    try {
      const nextReport = await api(`/reports/weekly${params.toString() ? `?${params}` : ''}`)
      setReport(nextReport)
      if (Array.isArray(nextReport.available_users)) setUsers(nextReport.available_users)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (!canFilterUsers) return
    api('/users?active_only=true').then(setUsers).catch(() => setUsers([]))
  }, [canFilterUsers])

  useEffect(() => { load() }, [startDate, endDate, userId])

  if (!displayedReport) return <div className="empty">جاري التحميل...</div>

  const selectedUser = users.find((item) => String(item.id) === String(userId))
  const kpiRows = collectKpiRows(displayedReport)
  const reviewRows = kpiRows.filter((row) => row.overrun_reason_text || row.production_issue_flagged || row.expected_time_complaint_text)

  return (
    <section>
      <div className="page-head">
        <div>
          <p className="eyebrow">{selectedUser ? selectedUser.full_name_ar : 'كل المستخدمين'}</p>
          <h1>مؤشرات الأداء (KPI)</h1>
        </div>
      </div>

      <div className="filters">
        <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        {canFilterUsers && (
          <select value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">كل المستخدمين</option>
            {users.map((item) => <option key={item.id} value={item.id}>{item.full_name_ar}</option>)}
          </select>
        )}
        <button onClick={load}>تحديث المؤشرات</button>
      </div>

      {error && <p className="error">{error}</p>}
      <KpiPanel kpi={displayedReport.kpi} />
      <KpiBreakdown rows={kpiRows} />
      <KpiCharts report={displayedReport} rows={kpiRows} />
      <ReviewTable rows={reviewRows} onOpenTask={openTask} />
    </section>
  )
}

function KpiPanel({ kpi }) {
  if (!kpi) return null
  const hasValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  const formatPercent = (value) => hasValue(value) ? `${value}%` : 'غير متوفر'
  const formatNumber = (value) => hasValue(value) ? value : '-'

  return (
    <article className="panel kpi-panel">
      <div className="panel-title-with-help">
        <h2>مؤشر الالتزام بالوقت</h2>
        <span className="help-tooltip" tabIndex="0" aria-label="طريقة احتساب مؤشر الالتزام">
          ?
          <span className="help-tooltip-content" role="tooltip">
            المعادلة: نسبة الالتزام = 100 - ((ساعات التأخير المحتسبة ÷ ساعات الوقت المتوقع) × 100)
          </span>
        </span>
      </div>
      <div className="kpi-grid">
        <div><strong>{formatPercent(kpi.commitment_rate)}</strong><span>نسبة الالتزام</span></div>
        <div><strong>{formatPercent(kpi.delay_rate)}</strong><span>نسبة التأخير المحتسبة</span></div>
        <div><strong>{formatNumber(kpi.attributable_delay_hours)}</strong><span>ساعات التأخير المحتسبة</span></div>
        <div><strong>{formatNumber(kpi.total_estimated_hours)}</strong><span>ساعات الوقت المتوقع</span></div>
      </div>
    </article>
  )
}

function KpiBreakdown({ rows }) {
  const totals = rows.reduce((current, row) => {
    current.evaluated += 1
    if (row.status === 'done') current.done += 1
    if (isFinishedEarly(row)) current.early += 1
    if (row.is_late || row.is_overdue) current.overrun += 1
    if (row.overrun_reason_text && !row.overrun_reason_approved) current.unreviewed += 1
    if (row.production_issue_flagged) current.productionFlags += 1
    return current
  }, { evaluated: 0, done: 0, early: 0, overrun: 0, unreviewed: 0, productionFlags: 0 })

  return (
    <div className="stats">
      <div><strong>{totals.evaluated}</strong><span>مهام داخلة في KPI</span></div>
      <div><strong>{totals.done}</strong><span>مهام منجزة</span></div>
      <div><strong>{totals.early}</strong><span>أنجزت قبل الوقت المتوقع</span></div>
      <div><strong>{totals.overrun}</strong><span>تجاوزت الوقت</span></div>
      <div><strong>{totals.unreviewed}</strong><span>بانتظار مراجعة السبب</span></div>
      <div><strong>{totals.productionFlags}</strong><span>أعلام إنتاج</span></div>
    </div>
  )
}

function KpiCharts({ report, rows }) {
  const delayData = (report.delay_reasons || []).slice(0, 6).map((item) => ({ label: item.reason, value: item.count || 0 })).filter((item) => item.value > 0)
  const timingData = [
    { label: 'قبل الوقت المتوقع', value: rows.filter(isFinishedEarly).length },
    { label: 'ضمن الوقت', value: rows.filter((row) => row.status === 'done' && !isFinishedEarly(row) && !(row.is_late || row.is_overdue)).length },
    { label: 'تجاوزت الوقت', value: rows.filter((row) => row.is_late || row.is_overdue).length },
  ].filter((item) => item.value > 0)

  return (
    <div className="report-charts">
      <article className="panel chart-card">
        <h2>أسباب تجاوز الوقت</h2>
        <BarChart data={delayData} />
      </article>
      <article className="panel chart-card">
        <h2>سرعة الإنجاز</h2>
        <BarChart data={timingData} />
      </article>
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

function ReviewTable({ rows, onOpenTask }) {
  return (
    <article className="panel">
      <h2>مراجعات تؤثر على KPI<small>{rows.length} مهمة</small></h2>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>المهمة</th>
                <th>المكلف</th>
                <th>تجاوزت الوقت؟</th>
                <th>مدة التجاوز</th>
                <th>سبب تجاوز الوقت</th>
                <th>اعتماد السبب</th>
                <th>اعتراض الوقت</th>
                <th>علم الإنتاج</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`kpi-${row.id}`}
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
                  <td>{row.title}</td>
                  <td>{row.assignee}</td>
                  <td>{row.is_late || row.is_overdue ? 'نعم' : 'لا'}</td>
                  <td>{formatOverrun(row)}</td>
                  <td>{row.overrun_reason_text || '-'}</td>
                  <td>{row.overrun_reason_text ? (row.overrun_reason_approved ? 'معتمد' : 'بانتظار المراجعة') : '-'}</td>
                  <td>{row.expected_time_complaint_text || '-'}</td>
                  <td>{row.production_issue_flagged ? (row.production_issue_reason || 'مرفوع') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState compact title="لا توجد مراجعات" description="ستظهر هنا أسباب التأخير، اعتراضات الوقت، وأعلام الإنتاج عند توفرها." />
      )}
    </article>
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

  return {
    ...report,
    completed_tasks: completedTasks,
    pending_in_progress_tasks: pendingInProgressTasks,
    delayed_tasks: delayedTasks,
    kpi: summarizeKpi(visibleRows),
  }
}

function collectKpiRows(report) {
  const byId = new Map()
  ;[...(report.completed_tasks || []), ...(report.pending_in_progress_tasks || []), ...(report.delayed_tasks || [])].forEach((row) => {
    if (isKpiEligibleRow(row)) byId.set(row.id, row)
  })
  return Array.from(byId.values())
}

function summarizeKpi(rows) {
  const kpiRows = rows.filter(isKpiEligibleRow)
  const totalEstimatedHours = kpiRows.reduce((total, row) => total + ((Number(row.expected_minutes) || 0) / 60), 0)
  const totalActualHours = kpiRows.reduce((total, row) => total + (Number(row.actual_hours) || 0), 0)
  const totalDelayHours = kpiRows.reduce((total, row) => total + (Number(row.delay_hours) || 0), 0)
  const attributableDelayHours = kpiRows.reduce((total, row) => total + attributableDelayForRow(row), 0)
  const rawDelayRate = totalEstimatedHours ? (attributableDelayHours / totalEstimatedHours) * 100 : null
  const delayRate = rawDelayRate === null ? null : Math.min(rawDelayRate, 100)
  return {
    evaluated_tasks: kpiRows.length,
    completed_tasks: kpiRows.filter((row) => row.status === 'done').length,
    total_estimated_hours: Number(totalEstimatedHours.toFixed(2)),
    total_actual_hours: Number(totalActualHours.toFixed(2)),
    overdue_tasks: kpiRows.filter((row) => row.is_late || row.is_overdue).length,
    total_delay_hours: Number(totalDelayHours.toFixed(2)),
    attributable_delay_hours: Number(attributableDelayHours.toFixed(2)),
    delay_rate: delayRate === null ? null : Number(delayRate.toFixed(2)),
    commitment_rate: delayRate === null ? null : Number(Math.max(0, 100 - delayRate).toFixed(2)),
  }
}

function isKpiEligibleRow(row) {
  if (['pending', 'cancelled'].includes(row.status)) return false
  return row.status === 'done' || Number(row.elapsed_seconds) > 0 || row.is_late || row.is_overdue
}

function isFinishedEarly(row) {
  return row.status === 'done'
    && Number(row.elapsed_seconds) > 0
    && Number(row.expected_minutes) > 0
    && Number(row.elapsed_seconds) < Number(row.expected_minutes) * 60
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

function attributableDelayForRow(row) {
  const delayHours = Number(row.delay_hours) || 0
  if (delayHours <= 0) return 0
  if (!row.overrun_reason_text) return delayHours
  if (!row.overrun_reason_approved) return delayHours
  const coefficients = { on_employee: 1, shared: 0.5, external: 0 }
  return delayHours * (coefficients[row.overrun_reason_category] ?? 1)
}
