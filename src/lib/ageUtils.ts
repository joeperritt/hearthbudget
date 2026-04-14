/**
 * Calculate current age from a date of birth string (YYYY-MM-DD or ISO).
 * Returns undefined if dob is falsy or unparseable.
 */
export function ageFromDob(dob: string | null | undefined): number | undefined {
  if (!dob) return undefined;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Calculate years until a person reaches a target age (default 22).
 */
export function yearsUntilAge(dob: string | null | undefined, targetAge = 22): number {
  const current = ageFromDob(dob);
  if (current === undefined) return 18; // fallback
  return Math.max(0, targetAge - current);
}

/**
 * Convert a stored numeric age to an approximate DOB (Jan 1 of birth year).
 * Used for migration from age-based to DOB-based storage.
 */
export function ageToDobApprox(age: number): string {
  const birthYear = new Date().getFullYear() - age;
  return `${birthYear}-01-01`;
}

/**
 * Format DOB for display (e.g. "Jan 1, 2000")
 */
export function formatDob(dob: string | null | undefined): string {
  if (!dob) return '';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
