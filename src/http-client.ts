import { createBodyRequestInit, parseResponseBody } from './body.js'
import { throwHttpError } from './errors.js'
import { mergeHeaders } from './headers.js'
import { createAuthRefreshInterceptor } from './auth-refresh.js'
import { createTimeoutSignal } from './timeout.js'
import { appendQuery } from './url.js'
import type {
  AuthRefreshOptions,
  BodyMethod,
  BodyResponse,
  FetchArgs,
  FetchLike,
  FetchRequestInterceptor,
  FetchResponseInterceptor,
  HttpClientOptions,
  HttpEvents,
  HttpGetOptions,
  HttpRequestOptions,
  QueryParams,
  ThrowOnErrorOptions,
} from './types.js'

export class HttpClient {
  private readonly baseUrl?: string | URL
  private readonly defaultHeaders?: HeadersInit
  private readonly fetchImpl: FetchLike
  private readonly requestInterceptors: FetchRequestInterceptor[]
  private readonly responseInterceptors: FetchResponseInterceptor[]
  private readonly requestEvents: NonNullable<HttpEvents['request']>[]
  private readonly responseEvents: NonNullable<HttpEvents['response']>[]
  private readonly exceptionEvents: NonNullable<HttpEvents['exception']>[]

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl
    this.defaultHeaders = options.headers
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.requestInterceptors = options.interceptors?.request
      ? [options.interceptors.request]
      : []
    this.responseInterceptors = options.interceptors?.response
      ? [options.interceptors.response]
      : []
    this.requestEvents = options.events?.request ? [options.events.request] : []
    this.responseEvents = options.events?.response ? [options.events.response] : []
    this.exceptionEvents = options.events?.exception
      ? [options.events.exception]
      : []
  }

  get handler(): FetchLike {
    return this.fetch.bind(this)
  }

  extend(options: HttpClientOptions = {}): HttpClient {
    return new HttpClient({
      fetch: options.fetch ?? this.fetchImpl,
      baseUrl: options.baseUrl ?? this.baseUrl,
      headers: mergeHeaders(this.defaultHeaders, options.headers),
      interceptors: {
        request: composeRequestInterceptors([
          ...this.requestInterceptors,
          ...(options.interceptors?.request ? [options.interceptors.request] : []),
        ]),
        response: composeResponseInterceptors([
          ...this.responseInterceptors,
          ...(options.interceptors?.response
            ? [options.interceptors.response]
            : []),
        ]),
      },
      events: {
        request: composeRequestEvents([
          ...this.requestEvents,
          ...(options.events?.request ? [options.events.request] : []),
        ]),
        response: composeResponseEvents([
          ...this.responseEvents,
          ...(options.events?.response ? [options.events.response] : []),
        ]),
        exception: composeExceptionEvents([
          ...this.exceptionEvents,
          ...(options.events?.exception ? [options.events.exception] : []),
        ]),
      },
    })
  }

  create(options: HttpClientOptions = {}): HttpClient {
    return this.extend(options)
  }

  withRequestInterceptor(interceptor: FetchRequestInterceptor): HttpClient {
    return this.extend({
      interceptors: {
        request: interceptor,
      },
    })
  }

  withResponseInterceptor(interceptor: FetchResponseInterceptor): HttpClient {
    return this.extend({
      interceptors: {
        response: interceptor,
      },
    })
  }

  withEvents(events: HttpEvents): HttpClient {
    return this.extend({
      events,
    })
  }

  withLogger(events: HttpEvents): HttpClient {
    return this.withEvents(events)
  }

  withThrowOnError<TErrorBody = unknown>(
    options?: ThrowOnErrorOptions<TErrorBody>,
  ): HttpClient {
    return this.withResponseInterceptor((response) =>
      throwHttpError(response, options),
    )
  }

  withErrorHandler<TErrorBody = unknown>(
    onError: NonNullable<ThrowOnErrorOptions<TErrorBody>['onError']>,
    options: Omit<ThrowOnErrorOptions<TErrorBody>, 'onError'> = {},
  ): HttpClient {
    return this.withThrowOnError<TErrorBody>({
      ...options,
      onError,
    })
  }

  withAuthRefresh(options: AuthRefreshOptions): HttpClient {
    return this.withResponseInterceptor(createAuthRefreshInterceptor(options))
  }

  async get<T>(
    input: URL | RequestInfo,
    options?: HttpGetOptions,
  ): Promise<BodyResponse<T>> {
    return this.request<T>(input, {
      ...options,
      method: 'GET',
    })
  }

  async post<T>(
    input: URL | RequestInfo,
    options?: HttpRequestOptions,
  ): Promise<BodyResponse<T>> {
    return this.requestWithBody<T>('POST', input, options)
  }

  async put<T>(
    input: URL | RequestInfo,
    options?: HttpRequestOptions,
  ): Promise<BodyResponse<T>> {
    return this.requestWithBody<T>('PUT', input, options)
  }

  async delete<T>(
    input: URL | RequestInfo,
    options?: HttpRequestOptions,
  ): Promise<BodyResponse<T>> {
    return this.requestWithBody<T>('DELETE', input, options)
  }

  async request<T>(
    input: URL | RequestInfo,
    init?: RequestInit,
  ): Promise<BodyResponse<T>> {
    return this.body<T>(input, init)
  }

  async fetch(input: URL | RequestInfo, init?: RequestInit): Promise<Response> {
    const startedAt = performance.now()
    let requestArgs: FetchArgs | undefined

    try {
      const requestResult = await this.performRequest(input, init)
      requestArgs = requestResult.requestArgs

      let response = requestResult.response
      const retryFetch = async (
        retryInput: URL | RequestInfo,
        retryInit?: RequestInit,
      ) => {
        const retryResult = await this.performRequest(retryInput, retryInit)
        return retryResult.response
      }

      for (const interceptor of this.responseInterceptors) {
        response = await interceptor(response, requestArgs, retryFetch)
      }

      await this.emitResponse({
        durationMs: performance.now() - startedAt,
        request: requestArgs,
        response,
      })

      return response
    } catch (error) {
      try {
        await this.emitException({
          durationMs: performance.now() - startedAt,
          error,
          request: requestArgs,
        })
      } catch {
        // Exception observers should not hide the original request failure.
      }

      throw error
    }
  }

  async body<T>(
    input: URL | RequestInfo,
    init?: RequestInit,
  ): Promise<BodyResponse<T>> {
    const response = await this.fetch(input, init)
    const body = await parseResponseBody(response)

    return {
      headers: response.headers,
      ok: response.ok,
      redirected: response.redirected,
      status: response.status,
      statusText: response.statusText,
      type: response.type,
      url: response.url,
      body,
    } as BodyResponse<T>
  }

  async throwOnError<TErrorBody = unknown>(
    response: Response,
    options?: ThrowOnErrorOptions<TErrorBody>,
  ): Promise<Response> {
    return throwHttpError(response, options)
  }

  private requestWithBody<T>(
    method: BodyMethod,
    input: URL | RequestInfo,
    options?: HttpRequestOptions,
  ): Promise<BodyResponse<T>> {
    return this.request<T>(input, createBodyRequestInit(method, options))
  }

  private async performRequest(
    input: URL | RequestInfo,
    init?: RequestInit,
  ): Promise<{ requestArgs: FetchArgs; response: Response }> {
    const normalizedArgs = applyDefaults(
      await normalizeFetchArgs(input, init),
      this.baseUrl,
      this.defaultHeaders,
    )

    let requestArgs = normalizedArgs
    for (const interceptor of this.requestInterceptors) {
      requestArgs = await interceptor(requestArgs, this.fetchImpl)
    }

    await this.emitRequest({
      request: requestArgs,
    })

    return {
      requestArgs,
      response: await this.fetchImpl(...requestArgs),
    }
  }

  private async emitRequest(
    event: Parameters<NonNullable<HttpEvents['request']>>[0],
  ): Promise<void> {
    for (const handler of this.requestEvents) {
      await handler(event)
    }
  }

  private async emitResponse(
    event: Parameters<NonNullable<HttpEvents['response']>>[0],
  ): Promise<void> {
    for (const handler of this.responseEvents) {
      await handler(event)
    }
  }

  private async emitException(
    event: Parameters<NonNullable<HttpEvents['exception']>>[0],
  ): Promise<void> {
    for (const handler of this.exceptionEvents) {
      await handler(event)
    }
  }
}

async function normalizeFetchArgs(
  input: URL | RequestInfo,
  init?: RequestInit,
): Promise<FetchArgs> {
  if (input instanceof Request) {
    const request = new Request(input, init)
    const body = await request.arrayBuffer()

    return [
      request.url,
      {
        body: body.byteLength ? body : undefined,
        cache: request.cache,
        credentials: request.credentials,
        headers: request.headers,
        integrity: request.integrity,
        keepalive: request.keepalive,
        method: request.method,
        mode: request.mode,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        signal: request.signal,
        window: null,
      },
    ]
  }

  return [input, init]
}

function applyDefaults(
  requestArgs: FetchArgs,
  baseUrl?: string | URL,
  headers?: HeadersInit,
): FetchArgs {
  const [input, init] = requestArgs
  const { query, timeoutMs, ...requestInit } = (init ?? {}) as RequestInit & {
    query?: QueryParams
    timeoutMs?: number
  }
  const nextHeaders = mergeHeaders(headers, requestInit.headers)
  const inputWithQuery = appendQuery(input, query)
  const url = baseUrl ? new URL(inputWithQuery.toString(), baseUrl) : inputWithQuery
  const signal = createTimeoutSignal(timeoutMs, requestInit.signal)

  return [
    url,
    {
      ...requestInit,
      headers: nextHeaders,
      signal,
    },
  ]
}

function composeRequestInterceptors(
  interceptors: FetchRequestInterceptor[],
): FetchRequestInterceptor | undefined {
  if (interceptors.length === 0) {
    return undefined
  }

  return async (requestArgs, fetchImpl) => {
    let nextArgs = requestArgs
    for (const interceptor of interceptors) {
      nextArgs = await interceptor(nextArgs, fetchImpl)
    }

    return nextArgs
  }
}

function composeResponseInterceptors(
  interceptors: FetchResponseInterceptor[],
): FetchResponseInterceptor | undefined {
  if (interceptors.length === 0) {
    return undefined
  }

  return async (response, requestArgs, fetchImpl) => {
    let nextResponse = response
    for (const interceptor of interceptors) {
      nextResponse = await interceptor(nextResponse, requestArgs, fetchImpl)
    }

    return nextResponse
  }
}

function composeRequestEvents(
  handlers: NonNullable<HttpEvents['request']>[],
): HttpEvents['request'] {
  if (handlers.length === 0) {
    return undefined
  }

  return async (event) => {
    for (const handler of handlers) {
      await handler(event)
    }
  }
}

function composeResponseEvents(
  handlers: NonNullable<HttpEvents['response']>[],
): HttpEvents['response'] {
  if (handlers.length === 0) {
    return undefined
  }

  return async (event) => {
    for (const handler of handlers) {
      await handler(event)
    }
  }
}

function composeExceptionEvents(
  handlers: NonNullable<HttpEvents['exception']>[],
): HttpEvents['exception'] {
  if (handlers.length === 0) {
    return undefined
  }

  return async (event) => {
    for (const handler of handlers) {
      await handler(event)
    }
  }
}
