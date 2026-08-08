import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { payments, memberships } from "@/db/schema";

type DB = typeof import("@/db").db;

/**
 * The single implementation of "mark a payment paid", extracted verbatim
 * from the payments router. Existence is checked first, then the only
 * guard: refunded payments can never be marked paid again. Pending and
 * failed payments are both accepted (idempotent for already-paid rows —
 * the update is a no-op).
 */
export async function markPaymentPaid(db: DB, params: { paymentId: number }) {
  const row = await db
    .select()
    .from(payments)
    .where(eq(payments.id, params.paymentId))
    .get();

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
  }
  if (row.status === "refunded") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Refunded payments cannot be marked paid.",
    });
  }

  return db
    .update(payments)
    .set({ status: "paid" })
    .where(eq(payments.id, params.paymentId))
    .returning()
    .get();
}

/**
 * The single implementation of "refund a payment", extracted verbatim from
 * the payments router. Only `paid` payments can be refunded; the refund
 * also cancels the linked membership (if any). Deliberately does NOT claw
 * back class credits already spent from that membership, and does NOT touch
 * the company pool (documented in ISSUES.md / BEHAVIOR_SPEC).
 */
export async function refundPayment(db: DB, params: { paymentId: number }) {
  const row = await db
    .select()
    .from(payments)
    .where(eq(payments.id, params.paymentId))
    .get();

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
  }
  if (row.status !== "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only paid payments can be refunded.",
    });
  }

  const updated = await db
    .update(payments)
    .set({ status: "refunded" })
    .where(eq(payments.id, params.paymentId))
    .returning()
    .get();

  if (row.membershipId) {
    await db
      .update(memberships)
      .set({ status: "cancelled" })
      .where(eq(memberships.id, row.membershipId));
  }

  return updated;
}
