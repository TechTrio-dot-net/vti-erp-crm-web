"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import { api } from "@/lib/api";

type CallResponse =
  | { mode: "phone"; status: "dialing" | "sent"; message: string }
  | { mode: "telephony"; message: string }
  | { mode: "unavailable"; tel: string; message: string };

const onPhoneBrowser = () => typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent);

/**
 * Call button: the user's phone (Voice Tunes India app) dials the lead, or Exotel rings them first.
 * Nothing to copy — the number never has to be typed on the phone.
 */
export function useClickToCall() {
  const queryClient = useQueryClient();
  const [pendingLeadId, setPendingLeadId] = useState<string | null>(null);

  const call = async (leadId: string) => {
    if (pendingLeadId) return;
    setPendingLeadId(leadId);
    const toastId = toast.loading("Sending the call to your phone…");
    try {
      const r = await api<CallResponse>("/calls/click-to-call", { method: "POST", body: JSON.stringify({ leadId }) });
      if (r.mode === "unavailable") {
        if (onPhoneBrowser()) {
          toast.dismiss(toastId);
          window.location.href = r.tel;
        } else {
          toast.error("Phone app not connected", { id: toastId, description: r.message, duration: 8000 });
        }
        return;
      }
      toast.success(r.mode === "phone" ? r.message : "Calling…", {
        id: toastId,
        description: r.mode === "phone" ? "The call is added to this lead when it ends" : r.message,
      });
      // The phone app / Exotel report the finished call a little later
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["crm"] }), 45_000);
    } catch (err) {
      toast.error("Call not started", { id: toastId, description: (err as Error).message, duration: 8000 });
    } finally {
      setPendingLeadId(null);
    }
  };

  return { call, pendingLeadId };
}

/** A phone number in a table that calls from the user's phone when clicked */
export function CallLink({ leadId, phone }: { leadId: string; phone: string | null | undefined }) {
  const { call, pendingLeadId } = useClickToCall();
  if (!phone) return <>—</>;
  return (
    <button
      type="button"
      title="Call from your phone"
      disabled={pendingLeadId !== null}
      onClick={(e) => {
        e.stopPropagation();
        call(leadId);
      }}
      className="inline-flex items-center gap-1.5 text-primary-text hover:underline whitespace-nowrap disabled:opacity-60"
    >
      <Phone className="size-3" />
      {phone}
    </button>
  );
}
