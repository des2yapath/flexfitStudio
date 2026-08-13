Found & fixed
Bugs that actually broke things

Infinite loading loop on /schedule — the page passed new Date().toISOString() into the query on every render, so the query key changed every render and React Query refetched forever. The page literally never loaded. Fixed by computing the timestamp once on mount. This was the big one — it was blocking the two main flows, booking and rescheduling.
Same bug in the reschedule modal — same fix.
passwordHash leaking to the browser — auth.me and a couple of mutations returned the full user row including the password hash. Fixed with one toSafeUser() helper used everywhere.
classes.byId was public and leaked member emails — anyone, even logged out, could fetch a class roster with member emails. Deleted it (nothing called it, so zero risk).
Capacity bug — personal and corporate bookings live in two separate tables, and each side only counted its own. A class could look half-full to one side and full to the other, letting people overbook. Fixed with one shared countBookedSeats() that both sides use.
Cancelling a class only cancelled half the attendees — classes.cancel updated personal bookings but never touched corporate bookings, so corporate employees stayed "booked" for a class that no longer existed. Now it cancels both tables, including waitlisted rows.
Reschedule never promoted the waitlist — when you moved classes, your old seat opened up but nobody from the waitlist got it. Now the freed seat promotes the next person.
Corporate check-ins lost their source — check-in rows were saved with bookingId: null, so you could never tell which class a check-in belonged to. Fixed as part of the booking-service rework.
The class-utilisation report was broken — showed nonsense numbers. Now shows real percentages.
Repeated logic pulled into one place

hoursUntil() existed identically in 3 router files → one shared copy.
activeMembershipFor() in 2 files → moved to its own memberships.ts.
getCompanyForMember() → shared.
The "last 14 days" window was hand-written 3–4 different ways in the admin reports → one daysFromNow() helper.
The trainer role check was copy-pasted 4–5 times → a proper trainerProcedure middleware, matching the existing staff/admin ones.
CSS / frontend mess

btn-sm, btn-outline, btn-danger were used ~20 times but never defined — those buttons had always rendered as plain buttons. Defined them in globals.css.
--bg-secondary and --fg were referenced but didn't exist. Added them.
Raw hex colors everywhere (error red in 5+ places, the gold "full" badge copy-pasted into two files) → replaced with design tokens and one shared <Badge> component.
any types on the company detail page → removed, real inferred types.
Dead code deleted

validateReschedule (~90 lines) — a duplicate of the reschedule validation that nothing called.
checkAvailability (~50 lines) — built to check trainer conflicts, never wired in anywhere.
Deleting these keeps behavior 100% identical — nothing that worked stopped working, which is the whole point of the assignment.

One behavior decision

Double active memberships — you could subscribe twice and end up with two active memberships, and three different parts of the app disagreed on which one counted. Fixed by blocking a second subscription while one is active.



Found but NOT fixed (on purpose)
Cancelling a class doesn't refund credits — when the gym cancels a class, members lose the credits they spent. No refund, no company-pool refund, no notification. Looks backwards, but it might be deliberate (staff can manually refund via the payments page). It's a product decision, so I documented it instead of silently changing it.
Attendance reports don't see corporate bookings — trainer stats and the no-show list only read the personal bookings table, so corporate-heavy trainers look underworked and corporate no-shows never appear. The clean fix needs a schema decision; patching each report would just recreate the same duplication one level up.
updateProfile({}) returns a 500 — sending an empty object crashes with "No values to set" instead of a clean error. Flagged.
setActive/setRole silently do nothing for a missing user — they return undefined instead of "not found", unlike byId. Minor inconsistency, flagged.
Deactivating a member doesn't kill their open session — blocks the next login, but an already-open session keeps working. Arguably a security quirk; documented rather than changed.
Failed login dumps raw JSON errors — the login page shows the raw Zod validation object. Ugly UX, not fixed.
Reschedule modal lists classes you're already booked on — it filters by name only, so it shows classes you already have. The server rejects with CONFLICT anyway, so no real harm.
