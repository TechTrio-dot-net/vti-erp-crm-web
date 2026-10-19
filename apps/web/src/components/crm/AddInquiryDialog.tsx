"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { isBdm, type CrmLead } from "@/lib/crm";
import { useAuthStore } from "@/store/auth";
import { useCrmUi } from "@/store/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls, textareaCls, useBdms, useServices } from "./ui";

const EMPTY = { name: "", phone: "", email: "", city: "", serviceId: "", source: "walk-in", campaign: "", estimatedValue: "", notes: "", assignTo: "" };
const SOURCES = ["walk-in", "phone call", "website", "referral", "instagram", "facebook", "google", "other"];

export function AddInquiryDialog() {
  const { inquiryOpen, closeInquiry, openLead } = useCrmUi();
  const role = useAuthStore((s) => s.user?.role);
  const queryClient = useQueryClient();
  const { data: services } = useServices();
  const { data: bdms } = useBdms();
  const [form, setForm] = useState(EMPTY);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      api<{ status: "created" | "duplicate"; lead: CrmLead }>("/crm/inquiries", {
        method: "POST",
        body: JSON.stringify({ ...form, serviceId: form.serviceId || undefined, assignTo: form.assignTo || undefined }),
      }),
    onSuccess: ({ status, lead }) => {
      queryClient.invalidateQueries({ queryKey: ["crm"] });
      if (status === "duplicate") {
        toast.warning("This mobile number already has an open lead", {
          description: `${lead.name} — assigned to ${lead.assignedName ?? "nobody"}. Added a repeat-enquiry note to it.`,
        });
      } else {
        toast.success("Inquiry added", { description: lead.assignedName ? `Assigned to ${lead.assignedName}` : "No BDM is started — lead is unassigned" });
      }
      setForm(EMPTY);
      closeInquiry();
      openLead(lead.id);
    },
  });

  return (
    <Dialog open={inquiryOpen} onOpenChange={(o) => !o && closeInquiry()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Inquiry</DialogTitle></DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.phone.trim() && !form.email.trim()) { toast.error("Enter a mobile number or email"); return; }
            mutation.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2"><Label>Name *</Label><Input value={form.name} onChange={set("name")} required autoFocus /></div>
            <div className="space-y-1.5"><Label>Mobile *</Label><Input value={form.phone} onChange={set("phone")} inputMode="tel" placeholder="98765 43210" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={set("email")} /></div>
            <div className="space-y-1.5"><Label>City</Label><Input value={form.city} onChange={set("city")} /></div>
            <div className="space-y-1.5">
              <Label>Service</Label>
              <select value={form.serviceId} onChange={set("serviceId")} className={`${selectCls} w-full`}>
                <option value="">—</option>
                {services?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <select value={form.source} onChange={set("source")} className={`${selectCls} w-full capitalize`}>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label>Value (₹)</Label><Input type="number" min={0} value={form.estimatedValue} onChange={set("estimatedValue")} /></div>
            {!isBdm(role) && (
              <div className="space-y-1.5 col-span-2">
                <Label>Assign to</Label>
                <select value={form.assignTo} onChange={set("assignTo")} className={`${selectCls} w-full`}>
                  <option value="">Automatic (round-robin)</option>
                  {bdms?.map((b) => <option key={b.id} value={b.id}>{b.name}{!b.inRotation ? " (stopped)" : ""}{b.onLeave ? " (on leave)" : ""}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5 col-span-2"><Label>Notes</Label><textarea rows={2} value={form.notes} onChange={set("notes")} className={textareaCls} /></div>
          </div>
          <DialogFooter className="pt-1">
            <Button type="button" variant="outline" onClick={closeInquiry}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Add Inquiry"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
