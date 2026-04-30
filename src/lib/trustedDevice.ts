// Trusted-device token storage. Stored in localStorage keyed per-user.
// Server hashes the token; we keep only the plaintext locally.
const KEY_PREFIX = 'keeper.mfa.trustedDevice.';

export function getTrustedDeviceToken(userId: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + userId);
  } catch {
    return null;
  }
}

export function setTrustedDeviceToken(userId: string, token: string) {
  try {
    localStorage.setItem(KEY_PREFIX + userId, token);
  } catch {
    /* storage unavailable */
  }
}

export function clearTrustedDeviceToken(userId: string) {
  try {
    localStorage.removeItem(KEY_PREFIX + userId);
  } catch {
    /* noop */
  }
}
