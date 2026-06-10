import { priorityLabels, statusLabels } from '../utils/labels'
import EmptyState from './EmptyState'

export default function TaskTable({ tasks, onOpen, onStatus }) {
  if (!tasks.length) return <EmptyState title="لا توجد مهام مطابقة" description="لا توجد نتائج ضمن عوامل التصفية الحالية." />
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>المهمة</th>
            <th>الحالة</th>
            <th>الأولوية</th>
            <th>المكلف</th>
            <th>القسم</th>
            <th>الوقت المتوقع</th>
            <th>تاريخ التسليم</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const overdue = new Date(task.due_date) < new Date().setHours(0, 0, 0, 0) && !['done', 'cancelled'].includes(task.status)
            return (
              <tr key={task.id} className={overdue ? 'overdue-row' : ''}>
                <td>
                  <button className="link-button" onClick={() => onOpen(task.id)}>{task.title}</button>
                  <small>{task.description || 'بدون وصف'}</small>
                  {task.delay_reason && <small className="muted">سبب التأخير: {task.delay_reason.name_ar}</small>}
                </td>
                <td><span className={`badge status-${task.status}`}>{statusLabels[task.status]}</span></td>
                <td>{priorityLabels[task.priority]}</td>
                <td>{task.assignee?.full_name_ar || '-'}</td>
                <td>{task.department?.name_ar || '-'}</td>
                <td>{Math.floor(task.expected_minutes / 60)}س {task.expected_minutes % 60}د</td>
                <td>{task.due_date}</td>
                <td className="actions">
                  {task.status === 'pending' && <button onClick={() => onStatus(task, 'in_progress')}>ابدأ المهمة</button>}
                  {task.status !== 'done' && <button onClick={() => onStatus(task, 'done')}>إنهاء المهمة</button>}
                  <button onClick={() => onOpen(task.id)}>التفاصيل</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
