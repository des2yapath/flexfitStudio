import { z } from "zod";
import { eq, and, gte } from "drizzle-orm";
import { classes, trainerAvailability } from "@/db/schema";
import { router, trainerProcedure } from "../trpc";

export const trainersRouter = router({
  upcomingClasses: trainerProcedure.query(async ({ ctx }) => {
    const now = new Date().toISOString();

    return ctx.db
      .select({
        id: classes.id,
        name: classes.name,
        room: classes.room,
        startsAt: classes.startsAt,
        durationMin: classes.durationMin,
        cancelled: classes.cancelled,
      })
      .from(classes)
      .where(
        and(
          eq(classes.trainerId, ctx.user.id),
          gte(classes.startsAt, now),
          eq(classes.cancelled, false),
        ),
      )
      .orderBy(classes.startsAt);
  }),

  availability: trainerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(trainerAvailability)
      .where(eq(trainerAvailability.trainerId, ctx.user.id))
      .orderBy(trainerAvailability.dayOfWeek);

    return rows;
  }),

  setAvailability: trainerProcedure
    .input(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string(),
        endTime: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(trainerAvailability)
        .where(
          and(
            eq(trainerAvailability.trainerId, ctx.user.id),
            eq(trainerAvailability.dayOfWeek, input.dayOfWeek),
          ),
        )
        .get();

      if (existing) {
        return ctx.db
          .update(trainerAvailability)
          .set({
            startTime: input.startTime,
            endTime: input.endTime,
          })
          .where(eq(trainerAvailability.id, existing.id))
          .returning()
          .get();
      } else {
        return ctx.db
          .insert(trainerAvailability)
          .values({
            trainerId: ctx.user.id,
            dayOfWeek: input.dayOfWeek,
            startTime: input.startTime,
            endTime: input.endTime,
          })
          .returning()
          .get();
      }
    }),

  removeAvailability: trainerProcedure
    .input(z.object({ dayOfWeek: z.number().int().min(0).max(6) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(trainerAvailability)
        .where(
          and(
            eq(trainerAvailability.trainerId, ctx.user.id),
            eq(trainerAvailability.dayOfWeek, input.dayOfWeek),
          ),
        )
        .get();

      if (existing) {
        await ctx.db
          .delete(trainerAvailability)
          .where(eq(trainerAvailability.id, existing.id));
      }

      return { success: true };
    }),

});
