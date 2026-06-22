import type { QueryParams, QueryValue } from './types.js'

export function appendQuery(input: string | URL, query?: QueryParams): string | URL {
  if (query === undefined) {
    return input
  }

  const queryString = createQueryString(query)
  if (!queryString) {
    return input
  }

  const url = input instanceof URL ? new URL(input) : new URL(input, 'http://local')
  const queryParams = new URLSearchParams(queryString)

  queryParams.forEach((value, key) => {
    url.searchParams.append(key, value)
  })

  if (input instanceof URL) {
    return url
  }

  if (isAbsoluteUrl(input)) {
    return url.toString()
  }

  return `${url.pathname}${url.search}${url.hash}`
}

function createQueryString(query: QueryParams): string {
  if (typeof query === 'string') {
    return query.startsWith('?') ? query.slice(1) : query
  }

  if (query instanceof URLSearchParams) {
    return query.toString()
  }

  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    appendQueryValue(params, key, value)
  })

  return params.toString()
}

function appendQueryValue(
  params: URLSearchParams,
  key: string,
  value: QueryValue,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => appendQueryValue(params, key, item))
    return
  }

  if (value === null || value === undefined) {
    return
  }

  params.append(key, String(value))
}

function isAbsoluteUrl(input: string): boolean {
  try {
    new URL(input)
    return true
  } catch {
    return false
  }
}
