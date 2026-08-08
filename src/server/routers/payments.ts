import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { payments, users, memberships, membershipPlans } from "@/db/schema";
import { markPaymentPaid, refundPayment } from "../services/payment-service";
import { router, protectedProcedure, adminProcedure } from "../trpc";

export const paymentsRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: payments.id,
        amountCents: payments.amountCents,
        method: payments.method,
        status: payments.status,
        reference: payments.reference,
        createdAt: payments.createdAt,
        planName: membershipPlans.name,
      })
      .from(payments)
      .leftJoin(memberships, eq(payments.membershipId, memberships.id))
      .leftJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
      .where(eq(payments.userId, ctx.user.id))
      .orderBy(desc(payments.createdAt));
  }),

  all: adminProcedure
    .input(z.object({ limit: z.number().default(100) }).default({}))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: payments.id,
          amountCents: payments.amountCents,
          method: payments.method,
          status: payments.status,
          reference: payments.reference,
          createdAt: payments.createdAt,
          memberName: users.name,
          memberEmail: users.email,
        })
        .from(payments)
        .innerJoin(users, eq(payments.userId, users.id))
        .orderBy(desc(payments.createdAt))
        .limit(input.limit);
    }),

  markPaid: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ ctx, input }) =>
      markPaymentPaid(ctx.db, { paymentId: input.id }),
    ),

  refund: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ ctx, input }) =>
      refundPayment(ctx.db, { paymentId: input.id }),
    ),
});
