/**
 * A Date exactly `days` calendar days from `from` (negative = the past).
 * Replaces the hand-recomputed 14-day windows that appeared four times in
 * the admin reporting router (expiringMemberships + the three report
 * queries), which were previously written out inline with setDate() math.
 */
export function daysFromNow(days: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}
