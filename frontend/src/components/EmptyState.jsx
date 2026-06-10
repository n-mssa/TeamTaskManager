import { ClipboardList } from 'lucide-react'

export default function EmptyState({ title = 'لا توجد مهام هنا', description = 'ستظهر العناصر هنا عند توفرها.', compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <div className="empty-state-icon"><ClipboardList size={20} /></div>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}
