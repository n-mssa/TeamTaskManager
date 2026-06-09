const currentHost = window.location.hostname || 'localhost'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${currentHost}:8010`

export function getToken() {
  return localStorage.getItem('team_tasks_token')
}

export function setToken(token) {
  if (token) localStorage.setItem('team_tasks_token', token)
  else localStorage.removeItem('team_tasks_token')
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers })
  if (!response.ok) {
    let message = 'حدث خطأ غير متوقع'
    try {
      const body = await response.json()
      message = body.detail || message
    } catch {
      message = response.statusText
    }
    throw new Error(message)
  }
  if (response.status === 204) return null
  return response.json()
}

export { API_BASE_URL }
