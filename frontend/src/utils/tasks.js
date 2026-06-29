export function elapsedSeconds(task) {
  let seconds = task.work_seconds || 0
  if (task.status === 'in_progress' && task.timer_started_at) {
    seconds += Math.max(0, Math.floor((Date.now() - new Date(task.timer_started_at).getTime()) / 1000))
  }
  return seconds
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return `${hours ? `${hours}س ` : ''}${minutes}د ${rest}ث`
}

export function isOverExpected(task) {
  return elapsedSeconds(task) > task.expected_minutes * 60
}

export function remainingExpectedSeconds(task) {
  return task.expected_minutes * 60 - elapsedSeconds(task)
}

export function statusChangePayload(task, nextStatus, user) {
  const payload = { status: nextStatus }
  const taskTitle = task.title ? `\n${task.title}` : ''

  if (nextStatus === 'blocked') {
    const reason = window.prompt(`سبب وضع المهمة قيد الانتظار:${taskTitle}`)
    if (!reason?.trim()) return null
    payload.hold_reason_text = reason.trim()
  }

  if (nextStatus === 'delayed') {
    const reason = window.prompt(`سبب تأخير المهمة:${taskTitle}`)
    if (!reason?.trim()) return null
    payload.delay_reason_text = reason.trim()
  }

  const exceededExpected = elapsedSeconds(task) > task.expected_minutes * 60
  const isAssignee = user?.id === task.assigned_to_user_id
  if (isAssignee && task.status === 'in_progress' && nextStatus !== 'in_progress' && exceededExpected && !task.overrun_reason_text) {
    const reason = window.prompt(`تجاوزت المهمة الوقت المتوقع. يرجى كتابة سبب التجاوز:${taskTitle}`)
    if (!reason?.trim()) return null
    payload.overrun_reason_text = reason.trim()
  }

  return payload
}

export function optimisticStatusTask(task, payload) {
  const now = new Date().toISOString()
  return {
    ...task,
    ...payload,
    status: payload.status,
    timer_started_at: payload.status === 'in_progress' ? task.timer_started_at || now : null,
    started_at: payload.status === 'in_progress' ? task.started_at || now : task.started_at,
    completed_at: payload.status === 'done' ? task.completed_at || now : null,
  }
}

export function replaceTask(tasks, updatedTask) {
  return tasks.map((task) => task.id === updatedTask.id ? updatedTask : task)
}
