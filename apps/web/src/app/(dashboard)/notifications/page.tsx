"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck, Trash2, Info } from "lucide-react";
import Link from "next/link";

type Notification = {
  id: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: string;
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Notification[]>("/notifications"),
  });

  const markAllRead = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "PATCH" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const deleteNotif = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = (notifications || []).filter((n) => !n.read).length;

  return (
    <div className="page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}` : "All caught up"}
          </p>
        </div>
        {notifications && notifications.length > 0 && (
          <Button
            variant="outline"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending || notifications.every((n) => n.read)}
          >
            <CheckCheck className="size-4" />
            Mark all read
          </Button>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <p className="text-[15px] font-semibold">All Notifications</p>
          {notifications && notifications.length > 0 && (
            <span className="badge badge-gray">{notifications.length} total</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-3 text-muted-foreground py-12">
            <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : !notifications?.length ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Bell className="size-6 text-muted-foreground" /></div>
            <p className="font-semibold">No notifications</p>
            <p className="text-sm text-muted-foreground mt-1">You&apos;re all caught up — nothing to see here</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/20 ${
                  !n.read ? "bg-primary/[0.03]" : ""
                }`}
              >
                <div className={`size-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  n.read ? "bg-muted" : "bg-primary/10"
                }`}>
                  {n.read
                    ? <Info className="size-4 text-muted-foreground" />
                    : <Bell className="size-4 text-primary-text" />
                  }
                </div>

                <div className="flex-1 min-w-0">
                  {n.link ? (
                    <Link href={n.link} className="block group">
                      <div className={`font-semibold text-[14px] group-hover:text-primary-text transition-colors ${n.read ? "text-foreground" : "text-foreground"}`}>
                        {n.title}
                      </div>
                      {n.body && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                    </Link>
                  ) : (
                    <>
                      <div className="font-semibold text-[14px] text-foreground">{n.title}</div>
                      {n.body && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                    </>
                  )}
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {new Date(n.createdAt).toLocaleString("en-IN", {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {!n.read && (
                    <span className="size-2 rounded-full bg-primary" />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => deleteNotif.mutate(n.id)}
                    disabled={deleteNotif.isPending}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
