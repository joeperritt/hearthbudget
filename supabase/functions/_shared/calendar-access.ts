/** A calendar can be written only when it has a Google Calendar ID and isn't marked view only. */
export function writeBlockReason(cal: { label: string; read_only?: boolean | null; google_calendar_id?: string | null }): string | null {
  return cal.read_only || !cal.google_calendar_id?.trim() ? `${cal.label} is view only in Perritt` : null;
}
