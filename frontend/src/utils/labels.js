export const statusLabels = {
  pending: 'بانتظار التنفيذ',
  in_progress: 'قيد التنفيذ',
  blocked: 'متوقف',
  delayed: 'متأخر',
  done: 'منجز',
  cancelled: 'ملغي',
}

export const priorityLabels = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'عالية',
  urgent: 'عاجلة',
}

export const roleLabels = {
  admin: 'مدير النظام',
  manager: 'مدير / قائد فريق',
  employee: 'موظف',
}

export const boardColumns = [
  { value: 'pending', label: statusLabels.pending },
  { value: 'in_progress', label: statusLabels.in_progress },
  { value: 'blocked', label: statusLabels.blocked },
  { value: 'done', label: statusLabels.done },
]

export const statusOptions = Object.entries(statusLabels).filter(([value]) => value !== 'delayed')
export const priorityOptions = Object.entries(priorityLabels)
