import { parseResponseBody } from './body.js'
import type { ThrowOnErrorOptions } from './types.js'

const httpErrorSymbol = Symbol.for('@overthinker/fetch/HttpError')

export class HttpError<TBody = unknown> extends Error {
  readonly [httpErrorSymbol] = true

  constructor(
    message: string,
    public readonly response: Response,
    public readonly body?: TBody,
  ) {
    super(message)
    this.name = 'HttpError'
  }

  get status(): number {
    return this.response.status
  }

  get statusText(): string {
    return this.response.statusText
  }

  get headers(): Headers {
    return this.response.headers
  }
}

export async function throwHttpError<TBody = unknown>(
  response: Response,
  options: ThrowOnErrorOptions<TBody> = {},
): Promise<Response> {
  const isErrorResponse =
    options.isErrorResponse ?? ((responseToCheck) => responseToCheck.status >= 400)

  if (!isErrorResponse(response)) {
    return response
  }

  const body = (await parseResponseBody(response.clone())) as TBody
  const message =
    options.resolveMessage?.(body, response) ??
    getErrorMessage(body, response.statusText)
  const error = new HttpError(message, response, body)

  await options.onError?.(error)

  throw error
}

export function isHttpError<TBody = unknown>(
  error: unknown,
): error is HttpError<TBody> {
  return (
    typeof error === 'object' &&
    error !== null &&
    httpErrorSymbol in error &&
    (error as { [httpErrorSymbol]?: unknown })[httpErrorSymbol] === true
  )
}

function getErrorMessage<TBody>(body: TBody, fallback: string): string {
  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return fallback
  }

  const message = (body as { message?: unknown }).message
  if (Array.isArray(message)) {
    return message.join(', ')
  }

  return typeof message === 'string' ? message : fallback
}
