import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookings,
  classes,
  companies,
  companyMembers,
  corporateBookings,
  memberships,
  type Booking,
  type CorporateBooking,
  type GymClass,
} from "@/db/schema";
import { activeMembershipFor } from "./memberships";

type DB = typeof import("@/db").db;

export type BookingKind = "personal" | "corporate";

/**
 * Plans with this many credits are treated as unlimited and never decrement.
 * (Moved here from bookings.ts — single source of truth.)
 */
export const UNLIMITED_CREDITS = 999;

/** Hours between now and a class start. Positive = class hasn't started yet. */
export function hoursUntil(iso: string, now = new Date()): number {
  return (new Date(iso).getTime() - now.getTime()) / 36e5;
}

/**
 * Confirmed seats for a class across BOTH the personal and corporate booking
 * tables. Fixes the split-capacity bug where each booking type only counted
 * itself, letting a class silently exceed capacity once both filled it.
 *
 * Two best-effort COUNTs (same race class as the original single COUNT — a
 * write can land between the read and the insert either way).
 */
export async function countBookedSeats(db: DB, classId: number): Promise<number> {
  const [personal, corporate] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(bookings)
      .where(and(eq(bookings.classId, classId), eq(bookings.status, "booked"))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(corporateBookings)
      .where(
        and(
          eq(corporateBookings.classId, classId),
          eq(corporateBookings.status, "booked"),
        ),
      ),
  ]);
  return Number(personal[0]?.count ?? 0) + Number(corporate[0]?.count ?? 0);
}

/**
 * Promotes the longest-waiting PERSONAL waitlister of a class into a confirmed
 * seat, charging `creditCost` from their own membership (skipped for unlimited
 * plans, floored at 0). Callers invoke this right after a seat was freed, so
 * exactly one promotion is always safe — no capacity re-check needed.
 */
export async function promoteNextWaitlisted(
  db: DB,
  classId: number,
): Promise<void> {
  const next = await db
    .select()
    .from(bookings)
    .where(
      and(eq(bookings.classId, classId), eq(bookings.status, "waitlisted")),
    )
    .orderBy(asc(bookings.bookedAt))
    .get();

  if (!next) return;

  const cls = await db
    .select({ creditCost: classes.creditCost })
    .from(classes)
    .where(eq(classes.id, classId))
    .get();
  if (!cls) return;

  await db
    .update(bookings)
    .set({ status: "booked", creditsUsed: cls.creditCost })
    .where(eq(bookings.id, next.id));

  if (next.membershipId) {
    const ms = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, next.membershipId))
      .get();

    if (ms && ms.creditsRemaining < UNLIMITED_CREDITS) {
      await db
        .update(memberships)
        .set({
          creditsRemaining: Math.max(0, ms.creditsRemaining - cls.creditCost),
        })
        .where(eq(memberships.id, ms.id));
    }
  }
}

/**
 * Same as promoteNextWaitlisted but for the corporate table: the promoted
 * member's COMPANY credit pool is charged, guarded by the pool balance
 * (promotion can push the pool to 0 but never below).
 */
export async function promoteNextCorporateWaitlisted(
  db: DB,
  classId: number,
): Promise<void> {
  const next = await db
    .select()
    .from(corporateBookings)
    .where(
      and(
        eq(corporateBookings.classId, classId),
        eq(corporateBookings.status, "waitlisted"),
      ),
    )
    .orderBy(asc(corporateBookings.bookedAt))
    .get();

  if (!next) return;

  const cls = await db
    .select({ creditCost: classes.creditCost })
    .from(classes)
    .where(eq(classes.id, classId))
    .get();
  if (!cls) return;

  await db
    .update(corporateBookings)
    .set({ status: "booked", creditsUsed: cls.creditCost })
    .where(eq(corporateBookings.id, next.id));

  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.id, next.companyId))
    .get();

  if (company && company.creditPoolBalance >= cls.creditCost) {
    await db
      .update(companies)
      .set({
        creditPoolBalance: Math.max(
          0,
          company.creditPoolBalance - cls.creditCost,
        ),
      })
      .where(eq(companies.id, company.id));
  }
}

/**
 * Cancels every active row (booked OR waitlisted) for a class in BOTH booking
 * tables. Fixes classes.cancel, which previously only cancelled personal
 * 'booked' rows — stranding corporate bookings and every waitlist forever.
 * Note: no refunds are issued here (credits/pool are not clawed back).
 */
export async function cancelClassBookings(
  db: DB,
  classId: number,
): Promise<void> {
  const cancelledAt = new Date().toISOString();

  await db
    .update(bookings)
    .set({ status: "cancelled", cancelledAt })
    .where(
      and(
        eq(bookings.classId, classId),
        inArray(bookings.status, ["booked", "waitlisted"]),
      ),
    );

  await db
    .update(corporateBookings)
    .set({ status: "cancelled", cancelledAt })
    .where(
      and(
        eq(corporateBookings.classId, classId),
        inArray(corporateBookings.status, ["booked", "waitlisted"]),
      ),
    );
}

/** The member's linked, active company (single company per member in practice). */
async function getCompanyForMember(db: DB, userId: number) {
  return db
    .select()
    .from(companyMembers)
    .innerJoin(companies, eq(companyMembers.companyId, companies.id))
    .where(
      and(eq(companyMembers.userId, userId), eq(companies.active, true)),
    )
    .get();
}

/**
 * The single implementation of "book a class", used by BOTH the personal and
 * corporate procedures. Preconditions run in the exact order the twin routers
 * used to: class exists → not cancelled → not started → no existing active
 * row → wallet check (membership credits OR company pool) → unified capacity
 * (both tables) → insert → charge.
 */
export async function bookClassFor(
  db: DB,
  params: { kind: BookingKind; userId: number; classId: number },
): Promise<Booking | CorporateBooking> {
  const cls = await db
    .select()
    .from(classes)
    .where(eq(classes.id, params.classId))
    .get();

  if (!cls) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
  }
  if (cls.cancelled) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This class has been cancelled.",
    });
  }
  if (hoursUntil(cls.startsAt) <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This class has already started.",
    });
  }

  if (params.kind === "personal") {
    const existing = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.classId, cls.id),
          eq(bookings.userId, params.userId),
          inArray(bookings.status, ["booked", "waitlisted"]),
        ),
      )
      .get();

    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "You are already on the list for this class.",
      });
    }

    const membership = await activeMembershipFor(db, params.userId);
    if (!membership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "An active membership is required to book classes.",
      });
    }

    const unlimited = membership.creditsRemaining >= UNLIMITED_CREDITS;
    if (!unlimited && membership.creditsRemaining < cls.creditCost) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Not enough class credits remaining.",
      });
    }

    // Unified capacity: counts BOTH personal and corporate confirmed seats.
    const isFull = (await countBookedSeats(db, cls.id)) >= cls.capacity;
    const created = await db
      .insert(bookings)
      .values({
        classId: cls.id,
        userId: params.userId,
        membershipId: membership.id,
        status: isFull ? "waitlisted" : "booked",
        creditsUsed: isFull ? 0 : cls.creditCost,
      })
      .returning()
      .get();

    if (!isFull && !unlimited) {
      await db
        .update(memberships)
        .set({ creditsRemaining: membership.creditsRemaining - cls.creditCost })
        .where(eq(memberships.id, membership.id));
    }

    return created;
  }

  // Corporate branch
  const existing = await db
    .select()
    .from(corporateBookings)
    .where(
      and(
        eq(corporateBookings.classId, cls.id),
        eq(corporateBookings.userId, params.userId),
        inArray(corporateBookings.status, ["booked", "waitlisted"]),
      ),
    )
    .get();

  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "You are already on the list for this class.",
    });
  }

  const companyRow = await getCompanyForMember(db, params.userId);
  if (!companyRow) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not linked to an active company.",
    });
  }

  const company = companyRow.companies;
  if (company.creditPoolBalance < cls.creditCost) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your company does not have enough credits.",
    });
  }

  // Unified capacity: counts BOTH personal and corporate confirmed seats.
  const isFull = (await countBookedSeats(db, cls.id)) >= cls.capacity;
  const created = await db
    .insert(corporateBookings)
    .values({
      classId: cls.id,
      userId: params.userId,
      companyId: company.id,
      status: isFull ? "waitlisted" : "booked",
      creditsUsed: isFull ? 0 : cls.creditCost,
    })
    .returning()
    .get();

  if (!isFull) {
    await db
      .update(companies)
      .set({
        creditPoolBalance: company.creditPoolBalance - cls.creditCost,
      })
      .where(eq(companies.id, company.id));
  }

  return created;
}

/**
 * The single implementation of "cancel a booking", used by BOTH the personal
 * and corporate procedures. Handles ownership, the refund policy (personal
 * membership credits vs company pool, with the kind-specific free window
 * passed in), and waitlist promotion of the freed seat.
 */
export async function cancelBookingFor(
  db: DB,
  params: {
    kind: BookingKind;
    bookingId: number;
    callerId: number;
    callerRole: string;
    freeCancellationHours: number;
  },
): Promise<{ ok: true; refunded: boolean }> {
  let row:
    | { kind: "personal"; booking: Booking; cls: GymClass }
    | { kind: "corporate"; booking: CorporateBooking; cls: GymClass };

  if (params.kind === "personal") {
    const r = await db
      .select({ booking: bookings, cls: classes })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(eq(bookings.id, params.bookingId))
      .get();
    if (!r) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }
    row = { kind: "personal", ...r };
  } else {
    const r = await db
      .select({ booking: corporateBookings, cls: classes })
      .from(corporateBookings)
      .innerJoin(classes, eq(corporateBookings.classId, classes.id))
      .where(eq(corporateBookings.id, params.bookingId))
      .get();
    if (!r) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
    }
    row = { kind: "corporate", ...r };
  }

  const isOwner = row.booking.userId === params.callerId;
  const isStaff = params.callerRole === "admin" || params.callerRole === "trainer";
  if (!isOwner && !isStaff) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot cancel this booking.",
    });
  }

  if (row.booking.status !== "booked" && row.booking.status !== "waitlisted") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This booking is no longer active.",
    });
  }

  const refundable =
    hoursUntil(row.cls.startsAt) >= params.freeCancellationHours &&
    row.booking.creditsUsed > 0;
  const cancelledAt = new Date().toISOString();

  if (row.kind === "personal") {
    await db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt })
      .where(eq(bookings.id, row.booking.id));

    if (refundable && row.booking.membershipId) {
      const ms = await db
        .select()
        .from(memberships)
        .where(eq(memberships.id, row.booking.membershipId))
        .get();

      if (ms && ms.creditsRemaining < UNLIMITED_CREDITS) {
        await db
          .update(memberships)
          .set({
            creditsRemaining: ms.creditsRemaining + row.booking.creditsUsed,
          })
          .where(eq(memberships.id, ms.id));
      }
    }

    // Freeing a confirmed spot promotes the member who has waited longest.
    if (row.booking.status === "booked") {
      await promoteNextWaitlisted(db, row.cls.id);
    }
    return { ok: true, refunded: refundable };
  }

  await db
    .update(corporateBookings)
    .set({ status: "cancelled", cancelledAt })
    .where(eq(corporateBookings.id, row.booking.id));

  if (refundable) {
    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.id, row.booking.companyId))
      .get();

    if (company) {
      await db
        .update(companies)
        .set({
          creditPoolBalance:
            company.creditPoolBalance + row.booking.creditsUsed,
        })
        .where(eq(companies.id, company.id));
    }
  }

  // Freeing a confirmed spot promotes the member who has waited longest.
  if (row.booking.status === "booked") {
    await promoteNextCorporateWaitlisted(db, row.cls.id);
  }
  return { ok: true, refunded: refundable };
}
