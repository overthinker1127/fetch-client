# @overthinker/fetch

Type-safe fetch client with explicit request options, response parsing, logging hooks, HTTP errors, and auth refresh presets.

## Basic Usage

```ts
import http from '@overthinker/fetch'

type User = {
  id: number
  name: string
}

type ApiError = {
  message: string | string[]
  code?: string
}

const api = http
  .create({
    baseUrl: 'https://api.example.com',
    headers: {
      accept: 'application/json',
    },
  })
  .withErrorHandler<ApiError>((error) => {
    if (error.status === 401) {
      // redirect to login or clear auth state
      return
    }

    console.error(error.message, error.body)
  })

const response = await api.get<User>('/users/1')
console.log(response.status)
console.log(response.body.name)
```

## Request Options

All method helpers use one explicit options object.

```ts
await api.get<User[]>('/users', {
  headers: {
    authorization: `Bearer ${token}`,
  },
  query: {
    active: true,
    page: 1,
    tag: ['admin', 'owner'],
  },
  timeoutMs: 5000,
})

await api.post<User>('/users', {
  headers: {
    authorization: `Bearer ${token}`,
  },
  body: {
    name: 'Ada',
  },
})

await api.delete('/users/bulk', {
  headers: {
    authorization: `Bearer ${token}`,
  },
  body: {
    ids: [1, 2],
  },
})
```

## Logging

Use `withLogger` to observe request, final response, and exceptions from one place.

```ts
const api = http.withLogger({
  request: ({ request }) => {
    const [url, init] = request
    console.log(`> [API] (${init?.method}) ${url.toString()}`)
  },
  response: ({ request, response, durationMs }) => {
    const [url, init] = request
    console.log(`< [API] (${init?.method}) ${url.toString()}`, {
      status: response.status,
      durationMs,
    })
  },
  exception: ({ request, error, durationMs }) => {
    const [url, init] = request ?? []
    console.error(`! [API] (${init?.method}) ${url?.toString()}`, {
      error,
      durationMs,
    })
  },
})
```

`request` is emitted after request interceptors and before the fetch call. `response` is emitted for the final response after response interceptors. `exception` is emitted for fetch errors, interceptor errors, and HTTP errors thrown by `withThrowOnError`.

## Auth Refresh

Use `withAuthRefresh` for 401 refresh flows. The refresh callback updates your token store; the client retries the original request once.

```ts
let accessToken: string | null = null

const api = http
  .create({ baseUrl: 'https://api.example.com' })
  .withRequestInterceptor(([url, init]) => {
    const headers = new Headers(init?.headers)

    if (accessToken) {
      headers.set('authorization', `Bearer ${accessToken}`)
    }

    return [url, { ...init, headers }]
  })
  .withAuthRefresh({
    shouldSkip: ([url]) =>
      ['/auth/login', '/auth/register', '/auth/refresh'].some((path) =>
        url.toString().includes(path),
      ),
    refresh: async (fetch) => {
      const response = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        accessToken = null
        throw new Error('failed to refresh token')
      }

      const body = (await response.json()) as { accessToken: string }
      accessToken = body.accessToken
    },
  })
  .withErrorHandler<ApiError>((error) => {
    console.error(error.status, error.message)
  })
```

Concurrent 401 responses share one in-flight refresh. Refresh requests and retries run through request interceptors, so token changes are picked up on retry.

## Error Policy

`withThrowOnError<TError>()` only wraps failed HTTP responses in `HttpError<TError>`. User-thrown errors from fetch implementations or interceptors pass through unchanged.

```ts
import { isHttpError } from '@overthinker/fetch'

try {
  await api.get('/users')
} catch (error) {
  if (isHttpError<ApiError>(error)) {
    console.log(error.status)
    console.log(error.body)
    return
  }

  throw error
}
```

Customize error detection and messages:

```ts
const api = http.withThrowOnError<{ error: string }>({
  isErrorResponse: (response) => response.status >= 300,
  resolveMessage: (body) => body.error,
})
```
