"use client";

import type { ReactNode } from "react";
import type { Calculation, Id, Option, PricedLine } from "@/lib/erp/types";
import { formatMoney, trimNumber, unitSuffix } from "@/lib/erp/format";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { Select } from "../ui/Select";

interface CalculationSummaryProps {
  calculation?: Calculation;
  loading?: boolean;
  /** "preview" = the selection being configured, not yet added to the quotation. */
  mode: "preview" | "quotation";
  onRemove?: (index: number) => void;
  /** Artist choices per service id, for assigning an artist to a saved line. */
  artistOptions?: Record<Id, Option[]>;
  onAssignArtist?: (index: number, artistId: string) => void;
  footer?: ReactNode;
}

export function CalculationSummary({ calculation, loading, mode, onRemove, artistOptions, onAssignArtist, footer }: CalculationSummaryProps) {
  const currency = calculation?.currency ?? "INR";

  return (
    <div className="rounded-xl border border-neutral-200 bg-paper shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-neutral-900">Calculation Summary</h2>
        <div className="flex items-center gap-2">
          {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />}
          {mode === "preview" && calculation && <Badge tone="soft">Preview</Badge>}
        </div>
      </div>

      {!calculation ? (
        <div className="px-5 py-10 text-center">
          <Icon name="rupee" className="mx-auto h-8 w-8 text-neutral-300" />
          <p className="mt-2 text-sm text-neutral-500">
            {loading ? "Calculating…" : "Select a service and fill in the details to see the price."}
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-neutral-100">
            {calculation.items.map((line, index) => (
              <SummaryLine
                key={index}
                line={line}
                currency={currency}
                onRemove={onRemove ? () => onRemove(index) : undefined}
                artistOptions={artistOptions?.[line.service_id]}
                onAssignArtist={onAssignArtist ? (artistId) => onAssignArtist(index, artistId) : undefined}
              />
            ))}
          </ul>

          <dl className="space-y-2 border-t border-neutral-200 bg-neutral-50 px-5 py-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-600">Subtotal</dt>
              <dd className="font-medium text-neutral-900">{formatMoney(calculation.subtotal, currency)}</dd>
            </div>
            {calculation.tax.enabled && (
              <div className="flex justify-between">
                <dt className="text-neutral-600">
                  {calculation.tax.label} ({trimNumber(calculation.tax.rate)}%)
                </dt>
                <dd className="font-medium text-neutral-900">{formatMoney(calculation.tax.amount, currency)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-neutral-200 pt-3">
              <dt className="font-semibold text-neutral-900">Grand Total</dt>
              <dd className="text-xl font-bold text-ink">{formatMoney(calculation.grand_total, currency)}</dd>
            </div>
          </dl>
        </>
      )}

      {footer && <div className="border-t border-neutral-200 px-5 py-4">{footer}</div>}
    </div>
  );
}

function SummaryLine({
  line,
  currency,
  onRemove,
  artistOptions,
  onAssignArtist,
}: {
  line: PricedLine;
  currency: string;
  onRemove?: () => void;
  artistOptions?: Option[];
  onAssignArtist?: (artistId: string) => void;
}) {
  const s = line.snapshot;
  // The artist can be changed here whenever this viewer may choose one for this
  // service; otherwise the assigned code is shown, or nothing while it's pending.
  const assignable = Boolean(onAssignArtist) && (artistOptions?.length ?? 0) > 0;
  const artistLabel = s.service.slug === "video-editing" ? "Video editor" : "Artist";
  const details: [string, string][] = [
    ...(!assignable && s.artist ? ([[artistLabel, s.artist.code]] as [string, string][]) : []),
    ...(s.video_type ? ([["Video type", s.video_type.name]] as [string, string][]) : []),
    ...(s.performer ? ([["Performer", s.performer.code]] as [string, string][]) : []),
    ...(s.source_language && s.language
      ? ([["Languages", `${s.source_language.name} → ${s.language.name}`]] as [string, string][])
      : s.language
        ? ([["Language", s.language.name]] as [string, string][])
        : []),
    // Services quoted per unit (e.g. Website) have no duration.
    ...(s.duration_label ? ([["Duration", s.duration_label]] as [string, string][]) : []),
    ["Quantity", String(line.quantity)],
    ["Rate", `${formatMoney(line.unit_price, currency)} ${unitSuffix(line.unit)}`],
    // For the team only; the printed quotation carries just the rate.
    ...(line.custom_price && line.base_price && line.base_price !== line.unit_price
      ? ([["Base price", `${formatMoney(line.base_price, currency)} ${unitSuffix(line.unit)}`]] as [string, string][])
      : []),
  ];

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-neutral-900">{s.service.name}</p>
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-neutral-900">{formatMoney(line.line_total, currency)}</p>
          {onRemove && (
            <button type="button" onClick={onRemove} className="rounded p-1 text-neutral-400 hover:bg-ink hover:text-paper" aria-label={`Remove ${s.service.name}`}>
              <Icon name="trash" className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {assignable && (
          <div className="contents">
            <dt className="self-center text-neutral-500">{artistLabel}</dt>
            <dd className="py-1">
              <Select
                className="max-w-44"
                aria-label={`${artistLabel} for ${s.service.name}`}
                placeholder="Not assigned yet"
                options={artistOptions ?? []}
                value={s.artist ? String(s.artist.id) : ""}
                onChange={(value) => onAssignArtist?.(value)}
              />
            </dd>
          </div>
        )}
        {details.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-neutral-500">{label}</dt>
            <dd className="text-neutral-700">{value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
