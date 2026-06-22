import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import http, {
  HttpClient,
  HttpError,
  type HttpResponse,
  isHttpError,
} from './index.js'

type ApiErrorBody = {
  message: string | string[]
  code?: string
}

function response(status: number, body?: unknown, contentType = 'application/json') {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'content-type': contentType },
  })
}

describe('http', () => {
  it('exposes http-style method helpers from the default export', () => {
    assert.equal(typeof http.get, 'function')
    assert.equal(typeof http.post, 'function')
    assert.equal(typeof http.put, 'function')
    assert.equal(typeof http.delete, 'function')
    assert.equal(typeof http.create, 'function')
    assert.equal(typeof http.withThrowOnError, 'function')
    assert.equal(typeof http.withErrorHandler, 'function')
    assert.equal(typeof http.withLogger, 'function')
  })
})

describe('HttpClient', () => {
  it('merges base url, default headers, request headers, and interceptors', async () => {
    const calls: unknown[] = []
    const fetchMock = async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push([input.toString(), init?.headers])
      return response(200, { ok: true })
    }

    const customHttp = new HttpClient({
      baseUrl: 'https://api.example.com/v1/',
      fetch: fetchMock,
      headers: {
        accept: 'application/json',
        authorization: 'Bearer default',
      },
      interceptors: {
        request: ([url, init]) => {
          const headers = new Headers(init?.headers)
          headers.set('authorization', 'Bearer override')
          return [url, { ...init, headers }]
        },
      },
    })

    const result = await customHttp.fetch('/users', {
      headers: {
        'x-request-id': 'req-1',
      },
    })

    assert.equal(result.status, 200)
    assert.equal(calls.length, 1)
    const [url, headers] = calls[0] as [string, Headers]
    assert.equal(url, 'https://api.example.com/users')
    assert.equal(headers.get('accept'), 'application/json')
    assert.equal(headers.get('authorization'), 'Bearer override')
    assert.equal(headers.get('x-request-id'), 'req-1')
  })

  it('can be extended with class-style interceptors', async () => {
    const calls: string[] = []
    const customHttp = new HttpClient({
      fetch: async (input) => {
        calls.push(input.toString())
        return response(200, { id: 1 })
      },
    }).withRequestInterceptor(([url, init]) => [
      new URL('/users/1', url),
      init,
    ])

    const result = await customHttp.body<{ id: number }>('https://api.example.com')

    assert.deepEqual(result.body, { id: 1 })
    assert.deepEqual(calls, ['https://api.example.com/users/1'])
  })

  it('supports get, post, put, and delete helpers', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const customHttp = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async (input, init) => {
        calls.push([input.toString(), init])
        return response(200, { ok: true })
      },
    })

    await customHttp.get('/users')
    await customHttp.post('/users', {
      body: { name: 'Ada' },
    })
    await customHttp.put('/users/1', {
      body: { name: 'Grace' },
    })
    await customHttp.delete('/users/1', {
      headers: {
        'x-delete-reason': 'duplicate',
      },
    })
    await customHttp.delete('/users/bulk', {
      body: { ids: [1, 2] },
      headers: {
        'x-request-id': 'req-1',
      },
    })

    assert.equal(calls[0]?.[1]?.method, 'GET')
    assert.equal(calls[1]?.[1]?.method, 'POST')
    assert.equal(calls[1]?.[1]?.body, JSON.stringify({ name: 'Ada' }))
    assert.equal(
      new Headers(calls[1]?.[1]?.headers).get('content-type'),
      'application/json',
    )
    assert.equal(calls[2]?.[1]?.method, 'PUT')
    assert.equal(calls[3]?.[1]?.method, 'DELETE')
    assert.equal(
      new Headers(calls[3]?.[1]?.headers).get('x-delete-reason'),
      'duplicate',
    )
    assert.equal(calls[3]?.[1]?.body, undefined)
    assert.equal(calls[4]?.[1]?.method, 'DELETE')
    assert.equal(calls[4]?.[1]?.body, JSON.stringify({ ids: [1, 2] }))
    assert.equal(
      new Headers(calls[4]?.[1]?.headers).get('content-type'),
      'application/json',
    )
    assert.equal(
      new Headers(calls[4]?.[1]?.headers).get('x-request-id'),
      'req-1',
    )
  })

  it('preserves explicit content-type and native BodyInit payloads', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const customHttp = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async (input, init) => {
        calls.push([input.toString(), init])
        return response(200, { ok: true })
      },
    })

    await customHttp.post('/text', {
      body: { raw: true },
      headers: {
        'content-type': 'application/vnd.api+json',
      },
    })
    await customHttp.post('/form', {
      body: new URLSearchParams({
        name: 'Ada',
      }),
    })

    assert.equal(calls[0]?.[1]?.body, JSON.stringify({ raw: true }))
    assert.equal(
      new Headers(calls[0]?.[1]?.headers).get('content-type'),
      'application/vnd.api+json',
    )
    assert.ok(calls[1]?.[1]?.body instanceof URLSearchParams)
    assert.equal(new Headers(calls[1]?.[1]?.headers).get('content-type'), null)
  })

  it('parses empty, invalid json, text, and blob responses predictably', async () => {
    const responses = [
      new Response(undefined, { status: 204 }),
      new Response('not json', {
        headers: {
          'content-type': 'application/json',
        },
      }),
      new Response('plain text', {
        headers: {
          'content-type': 'text/plain',
        },
      }),
      new Response('binary', {
        headers: {
          'content-type': 'application/octet-stream',
        },
      }),
    ]
    const customHttp = new HttpClient({
      fetch: async () => responses.shift() ?? response(500),
    })

    const empty = await customHttp.get<null>('/empty')
    const invalidJson = await customHttp.get<unknown>('/invalid-json')
    const text = await customHttp.get<string>('/text')
    const blob = await customHttp.get<Blob>('/blob')

    assert.equal(empty.body, '')
    assert.equal(invalidJson.body, 'not json')
    assert.equal(text.body, 'plain text')
    assert.ok(blob.body instanceof Blob)
  })

  it('supports create alias, query params, timeout, and HttpResponse alias', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const customHttp = http.create({
      baseUrl: 'https://api.example.com',
      fetch: async (input, init) => {
        calls.push([input.toString(), init])
        return response(200, { id: 1 })
      },
    })

    const result: HttpResponse<{ id: number }> = await customHttp.get('/users', {
      query: {
        active: true,
        empty: null,
        page: 1,
        tag: ['a', 'b'],
      },
      timeoutMs: 1000,
    })

    assert.deepEqual(result.body, { id: 1 })
    assert.equal(
      calls[0]?.[0],
      'https://api.example.com/users?active=true&page=1&tag=a&tag=b',
    )
    assert.equal(calls[0]?.[1]?.method, 'GET')
    assert.ok(calls[0]?.[1]?.signal instanceof AbortSignal)
  })

  it('appends query params to existing query strings and preserves hash fragments', async () => {
    const calls: string[] = []
    const customHttp = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async (input) => {
        calls.push(input.toString())
        return response(200, { ok: true })
      },
    })

    await customHttp.get('/users?sort=name#list', {
      query: {
        page: 1,
        tag: ['a', 'b'],
      },
    })
    await customHttp.get('https://cdn.example.com/assets?existing=true', {
      query: 'v=1',
    })

    assert.deepEqual(calls, [
      'https://api.example.com/users?sort=name&page=1&tag=a&tag=b#list',
      'https://cdn.example.com/assets?existing=true&v=1',
    ])
  })

  it('rejects invalid timeout values before fetch is called', async () => {
    let called = false
    const customHttp = new HttpClient({
      fetch: async () => {
        called = true
        return response(200, { ok: true })
      },
    })

    await assert.rejects(customHttp.get('/users', { timeoutMs: 0 }), {
      name: 'RangeError',
      message: 'timeoutMs must be greater than 0',
    })
    assert.equal(called, false)
  })

  it('combines timeout and caller abort signals', async () => {
    const controller = new AbortController()
    const calls: Array<RequestInit | undefined> = []
    const customHttp = new HttpClient({
      fetch: async (_input, init) => {
        calls.push(init)
        return response(200, { ok: true })
      },
    })

    await customHttp.get('/users', {
      signal: controller.signal,
      timeoutMs: 1000,
    })

    assert.ok(calls[0]?.signal instanceof AbortSignal)
    assert.notEqual(calls[0]?.signal, controller.signal)
  })

  it('does not duplicate interceptors when extended repeatedly', async () => {
    const events: string[] = []
    const customHttp = new HttpClient({
      fetch: async () => response(200, { ok: true }),
    })
      .withRequestInterceptor((args) => {
        events.push('first')
        return args
      })
      .withRequestInterceptor((args) => {
        events.push('second')
        return args
      })

    await customHttp.fetch('https://api.example.com/users')

    assert.deepEqual(events, ['first', 'second'])
  })

  it('replays request interceptors when a response interceptor retries', async () => {
    const calls: Array<[string, Headers]> = []
    let accessToken = 'expired'
    const customHttp = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async (input, init) => {
        calls.push([input.toString(), new Headers(init?.headers)])

        if (calls.length === 1) {
          return response(401)
        }

        return response(200, { ok: true })
      },
    })
      .withRequestInterceptor(([url, init]) => {
        const headers = new Headers(init?.headers)
        headers.set('authorization', `Bearer ${accessToken}`)

        return [url, { ...init, headers }]
      })
      .withResponseInterceptor((retryResponse, requestArgs, fetch) => {
        if (retryResponse.status !== 401) {
          return retryResponse
        }

        accessToken = 'fresh'
        return fetch(requestArgs[0], {
          ...requestArgs[1],
          authRetried: true,
        } as RequestInit & { authRetried: boolean })
      })

    const result = await customHttp.get<{ ok: boolean }>('/protected')

    assert.equal(result.status, 200)
    assert.equal(calls.length, 2)
    assert.equal(calls[0]?.[1].get('authorization'), 'Bearer expired')
    assert.equal(calls[1]?.[1].get('authorization'), 'Bearer fresh')
  })

  it('lets later response interceptors handle retry failures', async () => {
    let callCount = 0
    const customHttp = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async () => {
        callCount += 1

        if (callCount === 1) {
          return response(401)
        }

        return response(403, { message: 'refresh failed' })
      },
    })
      .withResponseInterceptor((retryResponse, requestArgs, fetch) => {
        if (retryResponse.status !== 401) {
          return retryResponse
        }

        return fetch(requestArgs[0], {
          ...requestArgs[1],
          authRetried: true,
        } as RequestInit & { authRetried: boolean })
      })
      .withThrowOnError()

    await assert.rejects(customHttp.get('/protected'), (error) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.message, 'refresh failed')
      assert.equal(error.response.status, 403)
      assert.equal(callCount, 2)
      return true
    })
  })

  it('throws HttpError with parsed body', async () => {
    const customHttp = new HttpClient({
      fetch: async () => response(400, { message: ['bad', 'request'] }),
    }).withThrowOnError()

    await assert.rejects(customHttp.fetch('/fail'), (error) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.message, 'bad, request')
      assert.equal(error.response.status, 400)
      assert.deepEqual(error.body, { message: ['bad', 'request'] })
      return true
    })
  })

  it('narrows HttpError body type for ergonomic error handling', async () => {
    const handledErrors: Array<{ status: number; code?: string }> = []
    const customHttp = new HttpClient({
      fetch: async () =>
        response(422, {
          message: 'validation failed',
          code: 'VALIDATION_FAILED',
        }),
    }).withErrorHandler<ApiErrorBody>((error) => {
      handledErrors.push({
        status: error.status,
        code: error.body?.code,
      })
    })

    try {
      await customHttp.post('/users', {
        body: {
          name: '',
        },
      })
      assert.fail('request should throw')
    } catch (error) {
      assert.ok(isHttpError<ApiErrorBody>(error))
      assert.equal(error.status, 422)
      assert.equal(error.statusText, '')
      assert.equal(error.body?.code, 'VALIDATION_FAILED')
      assert.equal(error.message, 'validation failed')
      assert.deepEqual(handledErrors, [
        {
          status: 422,
          code: 'VALIDATION_FAILED',
        },
      ])
    }
  })

  it('allows custom error status and message policies', async () => {
    const customHttp = new HttpClient({
      fetch: async () =>
        response(302, {
          error: 'redirect is not allowed here',
        }),
    }).withThrowOnError<{ error: string }>({
      isErrorResponse: (errorResponse) => errorResponse.status >= 300,
      resolveMessage: (body) => body.error,
    })

    await assert.rejects(customHttp.get('/redirect'), (error) => {
      assert.ok(isHttpError<{ error: string }>(error))
      assert.equal(error.status, 302)
      assert.equal(error.body?.error, 'redirect is not allowed here')
      assert.equal(error.message, 'redirect is not allowed here')
      return true
    })
  })

  it('passes through user-thrown interceptor errors without wrapping', async () => {
    const userError = new TypeError('user interceptor failed')
    const customHttp = new HttpClient({
      fetch: async () => response(200, { ok: true }),
    })
      .withRequestInterceptor(() => {
        throw userError
      })
      .withThrowOnError<ApiErrorBody>()

    await assert.rejects(customHttp.get('/users'), (error) => {
      assert.equal(error, userError)
      assert.equal(isHttpError(error), false)
      return true
    })
  })

  it('supports request, response, and exception logging hooks', async () => {
    const logs: string[] = []
    const customHttp = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async () => response(200, { ok: true }),
    }).withLogger({
      request: ({ request }) => {
        const [url, init] = request
        logs.push(`> ${init?.method} ${url.toString()}`)
      },
      response: ({ request, response, durationMs }) => {
        const [url, init] = request
        logs.push(
          `< ${response.status} ${init?.method} ${url.toString()} ${durationMs >= 0}`,
        )
      },
      exception: ({ error }) => {
        logs.push(`! ${error instanceof Error ? error.message : 'unknown'}`)
      },
    })

    await customHttp.get('/users')

    assert.deepEqual(logs, [
      '> GET https://api.example.com/users',
      '< 200 GET https://api.example.com/users true',
    ])
  })

  it('emits exception hooks for HTTP errors without replacing the thrown error', async () => {
    const logs: string[] = []
    const observerError = new Error('logger failed')
    const customHttp = new HttpClient({
      fetch: async () => response(500, { message: 'server failed' }),
    })
      .withLogger({
        exception: ({ error }) => {
          logs.push(
            isHttpError<ApiErrorBody>(error)
              ? `${error.status}:${error.message}`
              : 'unknown',
          )
          throw observerError
        },
      })
      .withThrowOnError<ApiErrorBody>()

    await assert.rejects(customHttp.get('/users'), (error) => {
      assert.ok(isHttpError<ApiErrorBody>(error))
      assert.equal(error.message, 'server failed')
      assert.deepEqual(logs, ['500:server failed'])
      return true
    })
  })
})
