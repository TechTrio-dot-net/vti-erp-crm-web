"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type LiveNotification = { id: string; title?: string; body?: string | null; type?: string | null; link?: string | null; createdAt: string };

type RealtimeResponse = { now: string; signals: Record<string, number>; notifications: LiveNotification[] };

/** Query keys refreshed when a signal changes on the server */
const SIGNAL_QUERIES: Record<string, string[][]> = {
  kanban: [["projects"], ["tasks"]],
  crm: [["crm"]],
};

const VISIBLE_MS = 8_000;
const HIDDEN_MS = 30_000;

/**
 * Live updates for the signed-in user. The server is serverless (no sockets), so this polls
 * GET /api/realtime: new notifications are passed to `onNotification`, and task boards and CRM lists
 * refetch when something changed elsewhere (another user, or a BDM's phone logging a call).
 * Mount it once, in the dashboard layout.
 */
export function useRealtime(enabled: boolean, onNotification: (n: LiveNotification) => void) {
  const queryClient = useQueryClient();
  const handler = useRef(onNotification);
  handler.current = onNotification;

  useEffect(() => {
    if (!enabled) return;
    let since: string | null = null;
    let seen: Record<string, number> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight = false;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(poll, document.visibilityState === "visible" ? VISIBLE_MS : HIDDEN_MS);
    };

    async function poll() {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        const data = await api<RealtimeResponse>(since ? `/realtime?since=${encodeURIComponent(since)}` : "/realtime");
        since = data.now;
        if (seen) {
          for (const [key, version] of Object.entries(data.signals)) {
            if (seen[key] !== version) SIGNAL_QUERIES[key]?.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
          }
        }
        seen = data.signals;
        // Oldest first, so the tab title ends on the newest one
        [...data.notifications].reverse().forEach((n) => handler.current(n));
      } catch {
        // Offline or signed out: try again on the next tick
      } finally {
        inFlight = false;
        schedule();
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, queryClient]);
}
