import { router } from "../trpc";
import { authRouter } from "./auth";
import { membersRouter } from "./members";
import { plansRouter } from "./plans";
import { classesRouter } from "./classes";
import { bookingsRouter } from "./bookings";
import { paymentsRouter } from "./payments";
import { adminRouter } from "./admin";
import { notificationsRouter } from "./notifications";
import { trainersRouter } from "./trainers";
import { corporateBookingsRouter } from "./corporate-bookings";
import { adminCompaniesRouter } from "./admin-companies";
import { reschedulesRouter } from "./reschedules";

export const appRouter = router({
  auth: authRouter,
  members: membersRouter,
  plans: plansRouter,
  classes: classesRouter,
  bookings: bookingsRouter,
  reschedules: reschedulesRouter,
  corporateBookings: corporateBookingsRouter,
  payments: paymentsRouter,
  admin: adminRouter,
  adminCompanies: adminCompaniesRouter,
  notifications: notificationsRouter,
  trainers: trainersRouter,
});

export type AppRouter = typeof appRouter;
