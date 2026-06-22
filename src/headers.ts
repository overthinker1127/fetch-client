export function mergeHeaders(
  defaultHeaders?: HeadersInit,
  overrideHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(defaultHeaders)
  new Headers(overrideHeaders).forEach((value, key) => {
    headers.set(key, value)
  })

  return headers
}
