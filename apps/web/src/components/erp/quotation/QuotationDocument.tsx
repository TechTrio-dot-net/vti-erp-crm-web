import Image from "next/image";
import type { Id, PricedLine, Quotation, QuotationLookups } from "@/lib/erp/types";
import { formatDate, formatMoney, trimNumber, unitSuffix } from "@/lib/erp/format";

type Line = PricedLine & { id: Id };

const LETTERHEAD = "/media/Letter-Head.jpg";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-neutral-500";

// Text area on the A4 letterhead (210 × 297 mm), in container-width units (100cqw = 210 mm)
// so it lines up with the artwork at any screen width and in print.
const PAGE_HEIGHT = "min-h-[141.4cqw]"; // one A4 page
// On screen the letterhead is split so a long quotation never runs under it: the top 92%
// (logo, rule, watermark) sits at the top of the sheet, the footer strip at the very bottom.
const SCREEN_TOP_ART = "h-[130.2cqw]";
const SCREEN_FOOTER_ART = "h-[11.2cqw]";
const SPACE_TOP = "h-[25.7cqw]"; // 54 mm — below the logo and yellow rule
const SPACE_BOTTOM = "h-[12.9cqw]"; // 27 mm — above the address line in the footer
const SPACE_SIDES = "px-[7.6cqw]"; // 16 mm

/**
 * Split text into paragraphs on blank lines and join the lines inside each one, so text
 * pasted from a PDF or email (with hard line breaks) flows and justifies to the full width.
 */
function paragraphs(text: string | null): string[] {
  return (text ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** "Voice Over & Dubbing" — the services on a quotation, used when no subject is entered. */
export function servicesSubject(lines: Pick<PricedLine, "snapshot">[]): string {
  const names = [...new Set(lines.map((line) => line.snapshot.service.name))];
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

/**
 * The quotation as sent to the client, printed on the VTI letterhead image. On screen the
 * letterhead is the sheet's background; in print it is repeated on every A4 page, and the
 * table header/footer spacers keep text clear of the logo and the footer on each page.
 */
export function QuotationDocument({ quotation: q, company }: { quotation: Quotation; company?: QuotationLookups["company"] }) {
  const lines = (q.items ?? []) as Line[];
  const services = (q.included_services ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const terms = (q.terms ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const subject = q.subject || servicesSubject(lines);
  const details = paragraphs(q.details);
  const scope = paragraphs(q.scope);
  const companyName = company?.name || "Voice Tunes India";

  return (
    // Always a true A4 sheet, so the screen matches print; narrow screens scroll sideways.
    <div className="overflow-x-auto print:overflow-visible">
    <article className="quotation-document @container relative mx-auto w-[210mm] shrink-0 bg-paper text-ink shadow-sm ring-1 ring-neutral-200 [print-color-adjust:exact] print:bg-transparent print:shadow-none print:ring-0">
      {/* Screen: letterhead top (logo, rule, watermark) and footer strip, cropped from the same image. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 ${SCREEN_TOP_ART} bg-no-repeat print:hidden`}
        style={{ backgroundImage: `url(${LETTERHEAD})`, backgroundSize: "100% auto", backgroundPosition: "top" }}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 bottom-0 ${SCREEN_FOOTER_ART} bg-no-repeat print:hidden`}
        style={{ backgroundImage: `url(${LETTERHEAD})`, backgroundSize: "100% auto", backgroundPosition: "bottom" }}
      />

      {/* Printed pages: the whole letterhead fixed behind every page. */}
      <Image
        src={LETTERHEAD}
        alt=""
        aria-hidden="true"
        width={2482}
        height={3508}
        unoptimized
        className="pointer-events-none hidden print:fixed print:left-0 print:top-0 print:block print:h-[297mm] print:w-[210mm]"
      />

      <div className={`relative ${PAGE_HEIGHT} print:min-h-0`}>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <td>
                <div className={SPACE_TOP} />
              </td>
            </tr>
          </thead>
          <tfoot>
            <tr>
              <td>
                <div className={SPACE_BOTTOM} />
              </td>
            </tr>
          </tfoot>
          <tbody>
            <tr>
              <td className={`${SPACE_SIDES} align-top`}>
                {/* Addressee, subject and client requirements */}
                <section>
                  <p className="font-semibold">To,</p>
                  <p className="font-semibold">{q.client_name},</p>
                </section>

                {subject && (
                  <h1 className="mt-6 text-center text-lg font-semibold underline decoration-brand decoration-2 underline-offset-4">
                    Quotation for {subject}
                  </h1>
                )}

                {details.length > 0 && (
                  <div className="mt-5 space-y-3 text-sm text-neutral-700">
                    {details.map((paragraph, index) => (
                      <p key={index} className="text-justify indent-10">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                )}

                {(scope.length > 0 || services.length > 0) && (
                  <section className="mt-6 text-sm">
                    <h2 className="text-base font-semibold">Project Scope</h2>
                    {scope.map((paragraph, index) => (
                      <p key={index} className="mt-2 text-justify text-neutral-700">
                        {paragraph}
                      </p>
                    ))}
                    {services.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-6 text-neutral-700">
                        {services.map((service, index) => (
                          <li key={index}>{service}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {/* Quotation */}
                <section className="mt-8 border-t border-neutral-200 pt-6">
                  <div className="flex justify-end border-b border-neutral-200 pb-6">
                    <div className="text-right">
                      <p className="inline-block border-b-4 border-brand pb-1 text-2xl font-bold tracking-tight text-ink">QUOTATION</p>
                      <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-sm">
                        <dt className="text-neutral-500">Number</dt>
                        <dd className="font-medium text-neutral-900">{q.quotation_number}</dd>
                        <dt className="text-neutral-500">Date</dt>
                        <dd className="text-neutral-900">{formatDate(q.created_at)}</dd>
                        <dt className="text-neutral-500">Valid until</dt>
                        <dd className="text-neutral-900">{formatDate(q.valid_until)}</dd>
                      </dl>
                    </div>
                  </div>

                  <div className="grid gap-6 py-6 sm:grid-cols-2">
                    <div>
                      <p className={LABEL}>Bill to</p>
                      <p className="mt-1 font-medium text-neutral-900">{q.client_name}</p>
                      {q.client_company && <p className="text-sm text-neutral-700">{q.client_company}</p>}
                      {q.client_address && <p className="whitespace-pre-line text-sm text-neutral-500">{q.client_address}</p>}
                      <p className="text-sm text-neutral-500">{[q.client_email, q.client_phone].filter(Boolean).join(" · ")}</p>
                      {q.client_gstin && <p className="text-sm text-neutral-500">GSTIN: {q.client_gstin}</p>}
                    </div>
                    <div className="sm:text-right">
                      <p className={LABEL}>Prepared by</p>
                      <p className="mt-1 text-sm font-medium text-neutral-900">{q.prepared_by_name ?? "—"}</p>
                      {q.prepared_by_phone && <p className="text-sm text-neutral-700">{q.prepared_by_phone}</p>}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                          <th className="px-3 py-2.5">#</th>
                          <th className="px-3 py-2.5">Service</th>
                          <th className="px-3 py-2.5 text-right">Duration</th>
                          <th className="px-3 py-2.5 text-right">Qty</th>
                          <th className="px-3 py-2.5 text-right">Rate</th>
                          <th className="px-3 py-2.5 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {lines.map((line, index) => {
                          const s = line.snapshot;
                          const languages = s.source_language && s.language ? `${s.source_language.name} → ${s.language.name}` : s.language?.name;
                          return (
                            <tr key={line.id} className="break-inside-avoid align-top">
                              <td className="px-3 py-3 text-neutral-500">{index + 1}</td>
                              <td className="px-3 py-3">
                                <p className="font-medium text-neutral-900">{s.service.name}</p>
                                <p className="text-xs text-neutral-500">{[s.artist?.code, s.video_type?.name, s.performer?.code, languages].filter(Boolean).join(" · ")}</p>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-right text-neutral-700">{s.duration_label || "—"}</td>
                              <td className="px-3 py-3 text-right text-neutral-700">{line.quantity}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-right text-neutral-700">
                                {formatMoney(line.unit_price, q.currency)}
                                <span className="text-xs text-neutral-400"> {unitSuffix(line.unit)}</span>
                              </td>
                              <td className="px-3 py-3 text-right font-medium text-neutral-900">{formatMoney(line.line_total, q.currency)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex justify-end break-inside-avoid">
                    <dl className="w-full max-w-xs space-y-2 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-neutral-600">Subtotal</dt>
                        <dd className="font-medium text-neutral-900">{formatMoney(q.subtotal, q.currency)}</dd>
                      </div>
                      {q.include_gst && Number(q.tax_rate) > 0 && (
                        <div className="flex justify-between">
                          <dt className="text-neutral-600">GST ({trimNumber(q.tax_rate)}%)</dt>
                          <dd className="font-medium text-neutral-900">{formatMoney(q.tax_amount, q.currency)}</dd>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-neutral-200 pt-2">
                        <dt className="font-semibold text-neutral-900">Grand Total</dt>
                        <dd className="rounded bg-brand px-2 text-lg font-bold text-ink">{formatMoney(q.grand_total, q.currency)}</dd>
                      </div>
                    </dl>
                  </div>
                </section>

                {terms.length > 0 && (
                  <section className="mt-8 break-inside-avoid border-t border-neutral-200 pt-6 text-sm">
                    <p className={LABEL}>Terms &amp; conditions</p>
                    <ul className="mt-2 space-y-1 text-neutral-700">
                      {terms.map((term, index) => (
                        <li key={index}>{term}</li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="mt-8 break-inside-avoid text-sm">
                  <p>Best regards,</p>
                  <p className="mt-3 font-semibold">{companyName}</p>
                  {q.prepared_by_name && <p>{q.prepared_by_name}</p>}
                  {q.prepared_by_phone && <p>{q.prepared_by_phone}</p>}
                </section>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
    </div>
  );
}
