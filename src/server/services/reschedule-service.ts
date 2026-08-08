import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { reschedules, bookings, classes } from "@/db/schema";
import {
  countBookedSeats,
  hoursUntil,
  promoteNextWaitlisted,
} from "./booking-service";

type DB = typeof import("@/db").db;

/**
 * Members may reschedule free of charge up to this many hours before the
 * original class starts. This is more generous than cancellation policy.
 * (Moved here from the router — the policy constant lives next to the
 * workflow that enforces it.)
 */
export const FREE_RESCHEDULE_HOURS = 4;

/**
 * The single implementation of "reschedule a booking". Extracted verbatim
 * from the reschedules router — every check runs in the exact same order,
 * throws the exact same errors, and makes the exact same writes:
 *
 * fetch original booking → ownership → status → free window → target class
 * exists → same name → not the same class → not started → not cancelled →
 * no duplicate active row → unified capacity (both tables) → insert new
 * booking (no credit charge) → cancel original → promote personal waitlist
 * → record reschedule row.
 */
export async function rescheduleClass(
  db: DB,
  params: { userId: number; fromBookingId: number; toClassId: number },
) {
  // Get the original booking with its class details
  const originalRow = await db
    .select({
      booking: bookings,
      cls: classes,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(eq(bookings.id, params.fromBookingId))
    .get();

  if (!originalRow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found.",
    });
  }

  const originalBooking = originalRow.booking;
  const originalClass = originalRow.cls;

  // Verify ownership
  if (originalBooking.userId !== params.userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot reschedule this booking.",
    });
  }

  // Verify booking is still active
  if (originalBooking.status !== "booked" && originalBooking.status !== "waitlisted") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This booking is no longer active.",
    });
  }

  // Verify reschedule is allowed (within 4 hours of original class)
  const hoursBeforeOriginal = hoursUntil(originalClass.startsAt);
  if (hoursBeforeOriginal < FREE_RESCHEDULE_HOURS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `You can only reschedule up to ${FREE_RESCHEDULE_HOURS} hours before the class starts.`,
    });
  }

  // Get target class
  const targetClass = await db
    .select()
    .from(classes)
    .where(eq(classes.id, params.toClassId))
    .get();

  if (!targetClass) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Target class not found.",
    });
  }

  // Verify target class has the same name
  if (targetClass.name !== originalClass.name) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You can only reschedule to a class with the same name.",
    });
  }

  // Verify target class is not the same class
  if (targetClass.id === originalClass.id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You are already booked for this class.",
    });
  }

  // Verify target class hasn't started
  if (hoursUntil(targetClass.startsAt) <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This class has already started.",
    });
  }

  // Verify target class is not cancelled
  if (targetClass.cancelled) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This class has been cancelled.",
    });
  }

  // Check if user already has an active booking for this class
  const existingBooking = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, targetClass.id),
        eq(bookings.userId, params.userId),
        sql`${bookings.status} in ('booked', 'waitlisted')`,
      ),
    )
    .get();

  if (existingBooking) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "You already have an active booking for this class.",
    });
  }

  // Capacity counts BOTH personal and corporate confirmed seats (was
  // split — each table only saw itself).
  const targetIsFull =
    (await countBookedSeats(db, targetClass.id)) >= targetClass.capacity;

  // Create the new booking (don't charge credits, they keep what they spent)
  const newBooking = await db
    .insert(bookings)
    .values({
      classId: targetClass.id,
      userId: params.userId,
      membershipId: originalBooking.membershipId,
      status: targetIsFull ? "waitlisted" : "booked",
      creditsUsed: originalBooking.creditsUsed, // Keep the same credits used
    })
    .returning()
    .get();

  // Cancel the original booking
  await db
    .update(bookings)
    .set({
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
    })
    .where(eq(bookings.id, originalBooking.id));

  // Freeing a confirmed spot promotes the member who has waited longest.
  // (Was missing — the freed seat silently never reached the queue.)
  if (originalBooking.status === "booked") {
    await promoteNextWaitlisted(db, originalClass.id);
  }

  // Record the reschedule
  await db.insert(reschedules).values({
    userId: params.userId,
    fromBookingId: originalBooking.id,
    toBookingId: newBooking.id,
    fromClassId: originalClass.id,
    toClassId: targetClass.id,
  });

  return {
    ok: true,
    newBooking,
    newStatus: targetIsFull ? "waitlisted" : "booked",
  };
}
