import { perimeterPost } from './http.ts'

/**
 * S-12 (FR-006): ending the session. The session is an `HttpOnly` cookie the app can never read
 * or delete, and Cezar has no sign-out (it has no sign-in either). So the perimeter does it:
 * `POST /m/session/end` answers 204 with a `Set-Cookie` that expires the gate's cookie
 * (`deploy/nginx/cezar-mobile.conf`, generated per host by `signout-from-unlock.sh`).
 *
 * Only a 204 counts. On a host where the endpoint is not installed the request falls through to
 * the static shell, which refuses a POST (405) — and the session is still there.
 */
export const SESSION_END_PATH = '/m/session/end'

/** @returns whether the perimeter confirmed the session is gone. Never throws. */
export async function endSession(): Promise<boolean> {
  try {
    return (await perimeterPost(SESSION_END_PATH)) === 204
  } catch {
    return false
  }
}
