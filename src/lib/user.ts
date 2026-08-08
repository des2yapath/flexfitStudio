import type { User } from "@/db/schema";

export type SafeUser = Omit<User, "passwordHash">;

/**
 * Strips the password hash from a full users row before it crosses the
 * tRPC boundary. Any procedure that returns a full row to the client
 * (auth.me, updateProfile, setActive, setRole, byId) must route it through
 * here — one place, not five.
 */
export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _omit, ...safe } = user;
  return safe;
}
