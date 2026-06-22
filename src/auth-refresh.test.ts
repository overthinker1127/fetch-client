import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HttpClient } from './http-client.js'

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  })
}

describe('auth refresh', () => {
  it('refreshes once and retries the original request', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    let accessToken = 'expired-access'
    const http = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async (input, init) => {
        calls.push([input.toString(), init])

        if (calls.length === 1) {
          return response(401)
        }

        if (input.toString() === 'https://api.example.com/auth/refresh') {
          accessToken = 'new-access'
          return response(200, {
            accessToken,
          })
        }

        return response(200, 'ok')
      },
    })
      .withRequestInterceptor(([url, init]) => {
        const headers = new Headers(init?.headers)
        headers.set('authorization', `Bearer ${accessToken}`)

        return [url, { ...init, headers }]
      })
      .withAuthRefresh({
        refresh: async (fetch) => {
          const refreshResponse = await fetch('/auth/refresh', {
            credentials: 'include',
            method: 'POST',
          })

          if (!refreshResponse.ok) {
            throw new Error('failed to refresh token')
          }
        },
      })

    await assert.doesNotReject(http.get('/protected'))

    assert.equal(calls.length, 3)
    assert.equal(calls[0]?.[0], 'https://api.example.com/protected')
    assert.equal(
      new Headers(calls[0]?.[1]?.headers).get('authorization'),
      'Bearer expired-access',
    )
    assert.equal(calls[1]?.[0], 'https://api.example.com/auth/refresh')
    assert.equal(calls[1]?.[1]?.method, 'POST')
    assert.equal(calls[1]?.[1]?.credentials, 'include')
    assert.equal(calls[2]?.[0], 'https://api.example.com/protected')
    assert.equal(
      new Headers(calls[2]?.[1]?.headers).get('authorization'),
      'Bearer new-access',
    )
  })

  it('does not refresh skipped requests', async () => {
    let callCount = 0
    const http = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async () => {
        callCount += 1
        return response(401)
      },
    }).withAuthRefresh({
      refresh: async () => {
        throw new Error('refresh should not run')
      },
      shouldSkip: ([url]) => url.toString().includes('/auth/login'),
    })

    const result = await http.post('/auth/login')

    assert.equal(result.status, 401)
    assert.equal(callCount, 1)
  })

  it('does not refresh a request that has already been retried', async () => {
    let refreshCount = 0
    const http = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async () => response(401),
    }).withAuthRefresh({
      refresh: async () => {
        refreshCount += 1
      },
    })

    const result = await http.get('/protected', {
      authRefreshRetried: true,
    } as RequestInit & { authRefreshRetried: boolean })

    assert.equal(result.status, 401)
    assert.equal(refreshCount, 0)
  })

  it('uses custom refresh conditions', async () => {
    let refreshCount = 0
    let callCount = 0
    const http = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async () => {
        callCount += 1
        return callCount === 1 ? response(419) : response(200, 'ok')
      },
    }).withAuthRefresh({
      refresh: async () => {
        refreshCount += 1
      },
      shouldRefresh: (refreshResponse) => refreshResponse.status === 419,
    })

    const result = await http.get('/protected')

    assert.equal(result.status, 200)
    assert.equal(refreshCount, 1)
    assert.equal(callCount, 2)
  })

  it('propagates refresh failures without retrying the original request', async () => {
    let callCount = 0
    const http = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async () => {
        callCount += 1
        return response(401)
      },
    }).withAuthRefresh({
      refresh: async () => {
        throw new Error('failed to refresh token')
      },
    })

    await assert.rejects(http.get('/protected'), {
      message: 'failed to refresh token',
    })
    assert.equal(callCount, 1)
  })

  it('shares an in-flight refresh across concurrent 401 responses', async () => {
    let refreshCount = 0
    const requestCounts = new Map<string, number>()
    const http = new HttpClient({
      baseUrl: 'https://api.example.com',
      fetch: async (input) => {
        const url = input.toString()
        const nextCount = (requestCounts.get(url) ?? 0) + 1
        requestCounts.set(url, nextCount)

        return nextCount === 1 ? response(401) : response(200, 'ok')
      },
    }).withAuthRefresh({
      refresh: async () => {
        refreshCount += 1
      },
    })

    await Promise.all([http.get('/a'), http.get('/b')])

    assert.equal(refreshCount, 1)
    assert.equal(requestCounts.get('https://api.example.com/a'), 2)
    assert.equal(requestCounts.get('https://api.example.com/b'), 2)
  })
})
