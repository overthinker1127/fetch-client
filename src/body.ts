import type { BodyMethod, HttpRequestOptions, RequestBody } from './types.js'

export function createBodyRequestInit(
  method: BodyMethod,
  options: HttpRequestOptions = {},
): RequestInit {
  const { body, ...init } = options

  if (body === undefined) {
    return {
      ...init,
      method,
    }
  }

  if (isBodyInit(body)) {
    return {
      ...init,
      body,
      method,
    }
  }

  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  return {
    ...init,
    body: JSON.stringify(body),
    headers,
    method,
  }
}

export async function parseResponseBody(
  response: Response,
): Promise<string | object | Blob> {
  const contentType = response.headers.get('content-type') ?? ''

  if (response.status === 204) {
    return ''
  }

  if (contentType.includes('application/json')) {
    return parseJsonSafely(await response.text())
  }

  if (
    contentType.includes('application/octet-stream') ||
    contentType.includes('image') ||
    contentType.includes('blob') ||
    contentType.includes('zip')
  ) {
    return response.blob()
  }

  return response.text()
}

export function parseJsonSafely(text: string): object | string {
  try {
    return JSON.parse(text)
  } catch (error) {
    if ((error as Error).name !== 'SyntaxError') {
      throw error
    }

    return text.trim()
  }
}

function isBodyInit(body: RequestBody): body is BodyInit {
  return (
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  )
}
