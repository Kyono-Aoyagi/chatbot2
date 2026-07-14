const ACCESS_CODE_STORAGE_KEY = 'code-reading-tutor.access-code'

export function getStoredAccessCode() {
  try {
    return window.localStorage.getItem(ACCESS_CODE_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setStoredAccessCode(code) {
  try {
    window.localStorage.setItem(ACCESS_CODE_STORAGE_KEY, code)
  } catch {
    // localStorageが使えない環境でも致命的にはしない
  }
}

const API_BASE = '/api'

export async function verifyAccessCode(code) {
  const response = await fetch(`${API_BASE}/verify-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessCode: code }),
  })
  if (!response.ok) return false
  const data = await response.json().catch(() => ({}))
  return data.ok === true
}
