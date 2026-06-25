const currentHost = window.location.hostname || 'localhost'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${currentHost}:8010`
const responseCache = new Map()
const pendingRequests = new Map()
const CACHE_TTL_MS = 30_000

function isCacheable(path, options) {
  if (options.method && options.method !== 'GET') return false
  return path === '/departments' || path.startsWith('/delay-reasons') || path.startsWith('/users?active_only=true')
}

function clearApiCache() {
  responseCache.clear()
  pendingRequests.clear()
}

export function getToken() {
  return localStorage.getItem('team_tasks_token')
}

export function setToken(token) {
  if (token) localStorage.setItem('team_tasks_token', token)
  else localStorage.removeItem('team_tasks_token')
  clearApiCache()
}

export async function api(path, options = {}) {
  const cacheable = isCacheable(path, options)
  const cached = responseCache.get(path)
  if (cacheable && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.data
  if (cacheable && pendingRequests.has(path)) return pendingRequests.get(path)

  const request = requestApi(path, options)
  if (cacheable) pendingRequests.set(path, request)
  try {
    const data = await request
    if (cacheable) responseCache.set(path, { createdAt: Date.now(), data })
    if (options.method && options.method !== 'GET') clearApiCache()
    return data
  } finally {
    if (cacheable) pendingRequests.delete(path)
  }
}

async function requestApi(path, options) {
  const isFormData = options.body instanceof FormData
  const headers = { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) }
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
