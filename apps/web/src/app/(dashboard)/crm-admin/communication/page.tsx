"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, CircleMinus, RefreshCw, Smartphone, Trash2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime, timeAgo } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { AdminOnly, DataTable, ErrorState, LoadingBlock, PageHeader } from "@/components/crm/ui";

type Check = { key: string; name: string; status: "ok" | "warning" | "error" | "off"; detail: string; fix?: string };
type Device = { id: string; userName: string; deviceName: string | null; appVersion: string | null; lastSyncAt: string | null; lastCallAt: string | null; permissionGranted: boolean; canDial: boolean; lastSeenAt: string | null };

const STATUS = {
  ok: { icon: CheckCircle2, cls: "text-emerald-600", label: "Working" },
  warning: { icon: TriangleAlert, cls: "text-amber-500", label: "Needs attention" },
  error: { icon: CircleAlert, cls: "text-red-600", label: "Broken" },
  off: { icon: CircleMinus, cls: "text-muted-foreground", label: "Not connected" },
};

const APIS = [
  { name: "Resend", use: "Email: welcome, password reset, task & deadline emails", need: "In use", cost: "Free up to 3,000 emails/month" },
  { name: "Google Sheets (Meta → Sheet)", use: "New Meta Ads leads every 2 minutes", need: "In use", cost: "Free" },
  { name: "Meta Graph API — Lead Ads", use: "Instant leads straight from Meta (skips the sheet)", need: "Optional", cost: "Free · needs a Meta app, Page access token (leads_retrieval) and a public webhook URL" },
  { name: "Voice Tunes India (Android app)", use: "Call button on the website dials from the salesperson's phone; reads the call log → calls, talk time, first-response time", need: "Recommended", cost: "Free · Android only" },
  { name: "Exotel (or MyOperator / Knowlarity / Tata Tele)", use: "Click-to-call from the company number with recordings; works on iPhone too", need: "Optional", cost: "≈ ₹1–2 per minute + number rental; KYC required" },
  { name: "WhatsApp Business Cloud API (or Interakt / AiSensy / Gupshup)", use: "Auto WhatsApp on new lead, templates, message history in the CRM", need: "Recommended", cost: "Per-conversation pricing by Meta; BSPs add a monthly fee" },
  { name: "AI voice agent (Vapi / Retell / ElevenLabs + Exotel or Plivo)", use: "AI answers or calls leads, qualifies them, writes the summary into the lead", need: "Optional", cost: "≈ ₹6–12 per minute all-in" },
  { name: "Tunnel or hosting (ngrok / Cloudflare Tunnel)", use: "Public address so Meta and Exotel can push events instantly", need: "Needed for webhooks", cost: "Free tiers available" },
];

export default function CommunicationPage() {
  return <AdminOnly><Communication /></AdminOnly>;
}

function Communication() {
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ["crm", "health"], queryFn: () => api<{ checkedAt: string; checks: Check[] }>("/integrations/health") });
  const devices = useQuery({ queryKey: ["crm", "devices"], queryFn: () => api<Device[]>("/calls/devices") });
  const removeDevice = useMutation({
    mutationFn: (id: string) => api(`/calls/devices/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Device removed"); queryClient.invalidateQueries({ queryKey: ["crm", "devices"] }); },
  });

  return (
    <div className="page space-y-5">
      <PageHeader title="Communication & Calls" subtitle="Live check of every channel the CRM uses to reach leads and your team">
        <Button variant="outline" onClick={() => health.refetch()} disabled={health.isFetching}>
          <RefreshCw className={`size-4 ${health.isFetching ? "animate-spin" : ""}`} />Check again
        </Button>
      </PageHeader>

      {health.isError ? <ErrorState /> : health.isLoading || !health.data ? <LoadingBlock rows={6} /> : (
        <div className="card divide-y divide-border/50">
          {health.data.checks.map((c) => {
            const meta = STATUS[c.status];
            const Icon = meta.icon;
            return (
              <div key={c.key} className="flex items-start gap-3 px-5 py-3.5">
                <Icon className={`size-5 mt-0.5 shrink-0 ${meta.cls}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{c.name} <span className={`text-xs font-medium ml-1 ${meta.cls}`}>{meta.label}</span></p>
                  <p className="text-sm text-muted-foreground">{c.detail}</p>
                  {c.fix && <p className="text-xs mt-1 text-foreground/80">→ {c.fix}</p>}
                </div>
              </div>
            );
          })}
          <p className="px-5 py-2 text-xs text-muted-foreground">Checked {fmtDateTime(health.data.checkedAt)}</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-5 space-y-3 text-sm">
          <p className="font-semibold flex items-center gap-2"><Smartphone className="size-4" />Set up call tracking on a phone</p>
          <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
            <li>Install <b>Voice Tunes India</b> (APK from <code>apps/mobile</code>) on the salesperson&apos;s Android phone.</li>
            <li>Open it, enter the CRM address — on the same Wi-Fi use your computer&apos;s address, e.g. <code>http://192.168.1.4:5001</code> — and sign in with their CRM username.</li>
            <li>Allow <b>Call logs</b> and <b>Phone</b> permission.</li>
            <li>Clicking <b>Call</b> on a lead in the CRM website now dials from that phone — no number to copy. Keep the app&apos;s “Ready for calls” notification on.</li>
            <li>Calls sync right after each call ends and every 15 minutes in the background. They appear on the lead and in <b>CRM → Call Log</b>.</li>
          </ol>
          <p className="text-xs text-muted-foreground">Only numbers are sent — never contacts, SMS or recordings. iPhones don&apos;t allow apps to read call history; use the calling service for them.</p>
        </div>
        <div className="card p-5 space-y-3 text-sm">
          <p className="font-semibold">Company calling line (Exotel)</p>
          <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
            <li>Create an Exotel account, finish KYC and buy an ExoPhone.</li>
            <li>In <code>apps/api/.env</code> set <code>EXOTEL_SID</code>, <code>EXOTEL_API_KEY</code>, <code>EXOTEL_API_TOKEN</code>, <code>EXOTEL_CALLER_ID</code> (the ExoPhone) and <code>EXOTEL_SUBDOMAIN</code>, then restart the API.</li>
            <li>Add each salesperson&apos;s mobile number in <b>BDM Master</b>.</li>
            <li>When a salesperson&apos;s phone app isn&apos;t connected, the <b>Call</b> button rings the salesperson first, then connects the customer from the company number, records it, and saves the duration.</li>
          </ol>
        </div>
      </div>

      <DataTable
        title="Connected phones"
        rows={devices.data ?? []}
        empty="No phones connected yet"
        columns={[
          { key: "userName", label: "Salesperson", className: "font-semibold" },
          { key: "deviceName", label: "Phone" },
          { key: "appVersion", label: "App" },
          {
            key: "lastSyncAt", label: "Last sync",
            render: (d) => {
              const stale = !d.lastSyncAt || Date.now() - new Date(d.lastSyncAt).getTime() > 2 * 3600_000;
              return <span className={stale ? "text-amber-600 font-medium" : ""}>{timeAgo(d.lastSyncAt)}</span>;
            },
          },
          {
            key: "canDial", label: "Call button",
            csv: (d) => (d.canDial && d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 90_000 ? "Ready" : "Offline"),
            render: (d) => {
              const ready = d.canDial && !!d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 90_000;
              return <span className={`badge ${ready ? "badge-green" : "badge-gray"}`} title={d.lastSeenAt ? `Last seen ${timeAgo(d.lastSeenAt)}` : undefined}>{ready ? "Ready" : d.canDial ? "Offline" : "No permission"}</span>;
            },
          },
          { key: "lastCallAt", label: "Last call", render: (d) => fmtDateTime(d.lastCallAt) },
          { key: "permissionGranted", label: "Permission", render: (d) => <span className={`badge ${d.permissionGranted ? "badge-green" : "badge-red"}`}>{d.permissionGranted ? "Allowed" : "Denied"}</span> },
          { key: "actions", label: "", csv: () => "", render: (d) => <Button size="sm" variant="ghost" className="h-7 px-2 hover:text-destructive" onClick={() => window.confirm("Remove this phone? Its calls stay.") && removeDevice.mutate(d.id)}><Trash2 className="size-3.5" /></Button> },
        ]}
      />

      <DataTable
        title="Third-party services"
        rows={APIS.map((a) => ({ ...a, id: a.name }))}
        columns={[
          { key: "name", label: "Service", className: "font-semibold" },
          { key: "use", label: "What it does" },
          { key: "need", label: "Status", render: (a) => <span className={`badge ${a.need === "In use" ? "badge-green" : a.need === "Recommended" ? "badge-blue" : "badge-gray"}`}>{a.need}</span> },
          { key: "cost", label: "Cost / requirement", className: "text-muted-foreground text-sm" },
        ]}
      />
    </div>
  );
}
