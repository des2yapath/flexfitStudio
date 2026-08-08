"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { AsyncState } from "@/components/ui/AsyncState";

export default function SchedulePage() {
  const utils = trpc.useUtils();
  const { data: user } = trpc.auth.me.useQuery();
  // Computed once per mount so the query key is stable — recomputing it on
  // every render made the key change each render, causing an infinite refetch loop.
  const [from] = useState(() => new Date().toISOString());
  const { data: classes, isLoading } = trpc.classes.list.useQuery({ from });

  const book = trpc.bookings.book.useMutation({
    onSuccess: async () => {
      await utils.classes.list.invalidate();
      await utils.bookings.mine.invalidate();
    },
  });

  if (isLoading)
    return <AsyncState isLoading loadingText="Loading schedule..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Class schedule</h1>
        <p className="muted mt-1 text-sm">
          {classes?.length ?? 0} upcoming classes
        </p>
      </div>

      {book.error && (
        <p className="panel p-3 text-sm" style={{ color: "var(--danger)" }}>
          {book.error.message}
        </p>
      )}

      <div className="space-y-2">
        {classes?.map((c) => (
          <div
            key={c.id}
            className="panel flex items-center gap-4 p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{c.name}</h2>
                {c.full && <Badge>Full</Badge>}
              </div>
              <p className="muted mt-0.5 text-sm">
                {formatDateTime(c.startsAt)} &middot; {c.room} &middot;{" "}
                {c.trainerName ?? "Unassigned"} &middot; {c.durationMin} min
              </p>
            </div>

            <div className="text-right text-sm muted">
              <div>
                {c.spotsLeft} / {c.capacity} left
              </div>
              <div>
                {c.creditCost} credit{c.creditCost === 1 ? "" : "s"}
              </div>
            </div>

            <button
              className="btn btn-primary"
              disabled={!user || book.isPending}
              onClick={() => book.mutate({ classId: c.id })}
            >
              {c.full ? "Join waitlist" : "Book"}
            </button>
          </div>
        ))}
      </div>

      {!user && (
        <p className="muted text-sm">Sign in to book a class.</p>
      )}
    </div>
  );
}
