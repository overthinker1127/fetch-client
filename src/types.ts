export type FetchArgs = [string | URL, RequestInit | undefined]

export type FetchLike = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>

export type FetchRequestInterceptor = (
  requestArgs: FetchArgs,
  fetch: FetchLike,
) => FetchArgs | Promise<FetchArgs>

export type FetchResponseInterceptor = (
  response: Response,
  requestArgs: FetchArgs,
  fetch: FetchLike,
) => Response | Promise<Response>

export type HttpRequestEvent = {
  request: FetchArgs
}

export type HttpResponseEvent = {
  request: FetchArgs
  response: Response
  durationMs: number
}

export type HttpExceptionEvent = {
  request?: FetchArgs
  error: unknown
  durationMs: number
}

export type HttpEvents = {
  request?: (event: HttpRequestEvent) => void | Promise<void>
  response?: (event: HttpResponseEvent) => void | Promise<void>
  exception?: (event: HttpExceptionEvent) => void | Promise<void>
}

export type HttpClientOptions = {
  fetch?: FetchLike
  baseUrl?: string | URL
  headers?: HeadersInit
  interceptors?: {
    request?: FetchRequestInterceptor
    response?: FetchResponseInterceptor
  }
  events?: HttpEvents
}

export type RequestBody = BodyInit | object | null | undefined

export type ErrorMessageResolver<TBody = unknown> = (
  body: TBody,
  response: Response,
) => string

export type ErrorHandler<TBody = unknown> = (
  error: import('./errors.js').HttpError<TBody>,
) => void | Promise<void>

export type ThrowOnErrorOptions<TBody = unknown> = {
  isErrorResponse?: (response: Response) => boolean
  resolveMessage?: ErrorMessageResolver<TBody>
  onError?: ErrorHandler<TBody>
}

export type AuthRefreshRetryInit = RequestInit & {
  authRefreshRetried?: boolean
}

export type AuthRefreshOptions = {
  refresh: (fetch: FetchLike, failedRequest: FetchArgs) => Promise<void>
  shouldRefresh?: (response: Response, request: FetchArgs) => boolean
  shouldSkip?: (request: FetchArgs) => boolean
  retryFlag?: keyof AuthRefreshRetryInit
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type BodyMethod = Exclude<HttpMethod, 'GET'>

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean | null | undefined)[]

export type QueryParams =
  | URLSearchParams
  | string
  | Record<string, QueryValue>

export type HttpRequestOptions = Omit<RequestInit, 'body' | 'method'> & {
  body?: RequestBody
  query?: QueryParams
  timeoutMs?: number
}

export type HttpGetOptions = Omit<HttpRequestOptions, 'body'>

export type ResponseGenericBody<T> = Omit<
  Awaited<ReturnType<typeof fetch>>,
  keyof Body | 'clone'
> & {
  body: T
}

export type BodyResponse<T> = T extends object
  ? ResponseGenericBody<T>
  : ResponseGenericBody<string | Blob>

export type HttpResponse<T> = BodyResponse<T>
