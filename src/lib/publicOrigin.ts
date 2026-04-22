// Returns the public-facing origin for outbound auth links (password reset, email verify, invites).
// Lovable preview/editor hosts require Lovable login, so links pointing there break for end users.
// Always route to the production custom domain when we detect a Lovable-hosted origin.
export function getPublicOrigin(): string {
  if (typeof window === "undefined") return "https://keeperbudget.com";
  const host = window.location.hostname;
  if (
    host.endsWith("lovableproject.com") ||
    host.endsWith("lovable.app") ||
    host.includes("id-preview--")
  ) {
    return "https://keeperbudget.com";
  }
  return window.location.origin;
}
