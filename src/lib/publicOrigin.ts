// Origin used for outbound auth links (password reset). Uses the current site origin.
export function getPublicOrigin(): string {
  if (typeof window === "undefined") return "https://hearthbudget.lovable.app";
  const host = window.location.hostname;
  // Preview/editor hosts require Lovable login, so route those links to the published app.
  if (host.includes("id-preview--") || host.endsWith("lovableproject.com")) {
    return "https://hearthbudget.lovable.app";
  }
  return window.location.origin;
}
