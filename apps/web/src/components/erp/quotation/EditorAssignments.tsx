"use client";

import { useState } from "react";
import Link from "next/link";
import type { ArtistAssignments, Option, QuotationLookups } from "@/lib/erp/types";
import { ApiError, api } from "@/lib/erp/api";
import { useApi } from "@/lib/erp/use-api";
import { formatDate } from "@/lib/erp/format";
import { Alert, Card, CardHeader } from "../ui/Card";
import { Select } from "../ui/Select";
import { useToast } from "../ui/Toast";
import { StatusBadge } from "./StatusBadge";

/**
 * Video editing lines written without an editor, for the roles that assign one
 * (artists.assign). Choosing an editor saves straight away and never changes
 * the quoted price.
 */
export function EditorAssignments() {
  const toast = useToast();
  const pending = useApi<ArtistAssignments>("/quotations/artist-assignments");
  const lookups = useApi<{ data: QuotationLookups }>("/lookups/quotation-form");
  const [saving, setSaving] = useState<string | null>(null);

  // Editors offered per service, by code — as on the quotation form.
  const editors = (serviceId: string): Option[] =>
    lookups.data?.data.services.find((service) => service.id === serviceId)?.artists.map((a) => ({ value: a.id, label: a.code })) ?? [];

  async function assign(quotationId: string, lineId: string, artistId: string) {
    if (!artistId) return;
    setSaving(lineId);

    try {
      const { data } = await api.patch<{ data: { quotation_number: string } }>(`/quotations/${quotationId}/items/${lineId}/artist`, { artist_id: artistId });
      toast.success(`Editor assigned on ${data.quotation_number}.`);
      pending.reload();
    } catch (error) {
      toast.error((error as ApiError).message);
    } finally {
      setSaving(null);
    }
  }

  const rows = pending.data?.data ?? [];
  const total = pending.data?.total ?? 0;

  return (
    <Card>
      <CardHeader
        title="Video editors to assign"
        description={
          pending.data
            ? total === 0
              ? "Every video editing line has an editor."
              : `${total} quotation${total === 1 ? "" : "s"} waiting for an editor${total > rows.length ? ` — showing the newest ${rows.length}` : ""}.`
            : "Quotations written without a video editor."
        }
      />
      {pending.error && (
        <div className="px-5 pb-4">
          <Alert>{pending.error.message}</Alert>
        </div>
      )}
      {!pending.data && !pending.error && <div className="mx-5 mb-5 h-16 animate-pulse rounded bg-neutral-50" />}
      {rows.length > 0 && (
        <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
          {rows.map((quotation) => (
            <li key={quotation.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={`/quotations/${quotation.id}`} className="text-sm font-semibold text-ink hover:underline">
                  {quotation.quotation_number}
                </Link>
                <StatusBadge status={quotation.status} />
                <span className="text-sm text-neutral-700">
                  {quotation.client_name}
                  {quotation.client_company && <span className="text-neutral-500"> · {quotation.client_company}</span>}
                </span>
                <span className="text-xs text-neutral-500">
                  {quotation.created_by ?? "Unknown"} · {formatDate(quotation.created_at)}
                </span>
              </div>
              <ul className="mt-3 space-y-2">
                {quotation.lines.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2">
                    <p className="text-sm text-neutral-700">
                      {[line.video_type, line.performer, line.duration_label, `Qty ${line.quantity}`].filter(Boolean).join(" · ")}
                    </p>
                    <Select
                      className="w-full sm:w-48"
                      aria-label={`Video editor for ${quotation.quotation_number}`}
                      placeholder={saving === line.id ? "Saving…" : "Select video editor"}
                      options={editors(line.service_id)}
                      value=""
                      disabled={saving !== null}
                      onChange={(artistId) => assign(quotation.id, line.id, artistId)}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
