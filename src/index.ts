export { createAuthRefreshInterceptor } from './auth-refresh.js'
export { createBodyRequestInit, parseJsonSafely, parseResponseBody } from './body.js'
export { HttpError, isHttpError, throwHttpError } from './errors.js'
export { mergeHeaders } from './headers.js'
export { HttpClient } from './http-client.js'
export { createTimeoutSignal } from './timeout.js'
export { appendQuery } from './url.js'
export type {
  AuthRefreshOptions,
  AuthRefreshRetryInit,
  BodyMethod,
  BodyResponse,
  FetchArgs,
  FetchLike,
  FetchRequestInterceptor,
  FetchResponseInterceptor,
  HttpClientOptions,
  HttpEvents,
  HttpGetOptions,
  HttpMethod,
  HttpExceptionEvent,
  HttpRequestOptions,
  HttpRequestEvent,
  HttpResponseEvent,
  RequestBody,
  ResponseGenericBody,
  HttpResponse,
  QueryParams,
  QueryValue,
  ThrowOnErrorOptions,
} from './types.js'

import { HttpClient } from './http-client.js'

export const http = new HttpClient()

export default http
