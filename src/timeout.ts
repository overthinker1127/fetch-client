export function createTimeoutSignal(
  timeoutMs?: number,
  signal?: AbortSignal | null,
): AbortSignal | undefined {
  if (timeoutMs === undefined) {
    return signal ?? undefined
  }

  if (timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be greater than 0')
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (!signal) {
    return timeoutSignal
  }

  return AbortSignal.any([signal, timeoutSignal])
}
