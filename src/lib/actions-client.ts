import { getAuthToken } from 'deepspace'

export interface ActionResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

export async function invokeAction<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionResponse<T>> {
  const token = await getAuthToken()
  if (!token) {
    return { success: false, error: 'Please sign in first.' }
  }

  const res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })

  const body = (await res.json().catch(() => ({}))) as ActionResponse<T>
  if (!res.ok) {
    return {
      success: false,
      error: body.error ?? `Action "${name}" failed (${res.status})`,
      code: body.code,
    }
  }
  return body
}
