import type {
  AuthRefreshOptions,
  AuthRefreshRetryInit,
  FetchResponseInterceptor,
} from './types.js'

const defaultRetryFlag = 'authRefreshRetried' satisfies keyof AuthRefreshRetryInit

export function createAuthRefreshInterceptor(
  options: AuthRefreshOptions,
): FetchResponseInterceptor {
  let refreshPromise: Promise<void> | null = null
  const retryFlag = options.retryFlag ?? defaultRetryFlag

  return async (response, request, fetch) => {
    const requestInit = request[1] as AuthRefreshRetryInit | undefined

    if (!shouldRefreshResponse(response, request, options)) {
      return response
    }

    if (options.shouldSkip?.(request) || requestInit?.[retryFlag]) {
      return response
    }

    refreshPromise ??= options.refresh(fetch, request).finally(() => {
      refreshPromise = null
    })

    await refreshPromise

    return fetch(request[0], {
      ...request[1],
      [retryFlag]: true,
    } as AuthRefreshRetryInit)
  }
}

function shouldRefreshResponse(
  response: Response,
  request: Parameters<FetchResponseInterceptor>[1],
  options: AuthRefreshOptions,
): boolean {
  return options.shouldRefresh?.(response, request) ?? response.status === 401
}
