/**
 * TigerStyle runtime invariant assertion.
 * Crash fast on programmer errors / violated preconditions rather than
 * propagating corrupt state silently.
 */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}
