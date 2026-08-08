import { and, desc, eq, sql } from "drizzle-orm";
import { memberships } from "@/db/schema";

type DB = typeof import("@/db").db;

/**
 * The member's active membership (status active AND not expired), newest end
 * date first. This is THE shared definition of "has an active membership" —
 * used by the booking flow (`bookClassFor`) and by `plans.subscribe` as its
 * double-membership guard, so the two can never disagree (ISSUES.md #6).
 * Moved here from booking-service so the membership concern lives in a
 * membership service instead of being reachable from a booking import.
 */
export async function activeMembershipFor(db: DB, userId: number) {
  const today = new Date().toISOString().slice(0, 10);
  return db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        sql`${memberships.endDate} >= ${today}`,
      ),
    )
    .orderBy(desc(memberships.endDate))
    .get();
}
