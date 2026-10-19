import { QUOTATION_STATUSES, QUOTATION_VALIDITIES, type QuotationStatus, type QuotationValidity } from '../db/schema';
import { Input, toBool } from './input';
import type { QuotationItemInput } from './pricing';

export const MAX_VALIDITY_DAYS = 365;

/** Client details and document text, saved as entered */
export const TEXT_FIELDS = [
  'client_name',
  'client_company',
  'client_email',
  'client_phone',
  'client_gstin',
  'client_address',
  'external_reference',
  'notes',
  'subject',
  'details',
  'scope',
  'included_services',
  'terms',
  'prepared_by_name',
  'prepared_by_phone',
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export interface QuotationData {
  text: Partial<Record<TextField, string | null>>;
  lead_id?: string | null;
  validity?: QuotationValidity;
  validity_days?: number | null;
  include_gst?: boolean;
  items: QuotationItemInput[];
}

/**
 * The shape of each line. Which fields a service actually requires, and whether the records are
 * active and linked, is checked by the pricing engine.
 */
function parseItems(input: Input): QuotationItemInput[] {
  const raw = input.raw('items');
  if (!Array.isArray(raw) || raw.length === 0) {
    input.fail('items', 'Add at least one service to the quotation.');
    return [];
  }
  if (raw.length > 50) {
    input.fail('items', 'A quotation may hold at most 50 lines.');
    return [];
  }

  return raw.map((value, index) => {
    const line = Input.from(value, `items.${index}`);
    const item: QuotationItemInput = {
      service_id: line.requiredId('service_id', 'Please select a service.'),
      artist_id: line.optionalId('artist_id', 'The selected artist is not available.') ?? null,
      language_id: line.optionalId('language_id', 'The selected language is not available.') ?? null,
      source_language_id: line.optionalId('source_language_id', 'The selected source language is not available.') ?? null,
      video_type_id: line.optionalId('video_type_id', 'The selected video type is not available.') ?? null,
      performer_id: line.optionalId('performer_id', 'The selected performer is not available.') ?? null,
      duration_id: line.optionalId('duration_id', 'The selected duration is not available.') ?? null,
      duration_minutes: null,
      quantity: 0,
      custom_price: null,
    };
    // A saved per-unit line (e.g. Website) comes back with 0 minutes; that means "no duration", and the
    // pricing engine still insists on one wherever the service needs it
    if (!item.duration_id && Number(line.raw('duration_minutes')) !== 0) {
      item.duration_minutes =
        line.number('duration_minutes', {
          nullable: true,
          decimals: 2,
          min: 0.01,
          max: 10000,
          message: 'Please select a duration or enter a custom duration.',
          minMessage: 'Please select a duration or enter a custom duration.',
          maxMessage: 'The duration may not be greater than 10000 minutes.',
        }) ?? null;
    }
    item.quantity =
      (line.number('quantity', {
        required: true,
        integer: true,
        min: 1,
        max: 10000,
        message: 'Quantity must be a whole number.',
        minMessage: 'Quantity must be at least 1.',
        maxMessage: 'Quantity may not be greater than 10000.',
      }) as number | undefined) ?? 0;
    item.custom_price =
      line.number('custom_price', {
        nullable: true,
        decimals: 2,
        min: 0.01,
        max: 9999999999,
        message: 'Enter a valid price.',
        minMessage: 'The price must be more than zero.',
        maxMessage: 'The price is too large.',
      }) ?? null;
    input.absorb(line);
    return item;
  });
}

const PHONE_RULE = { pattern: /^[0-9+\-\s()]+$/, patternMessage: 'The phone number may only contain digits, spaces, +, - and brackets.', raw: true };

/** Create or fully update a quotation (client details, document text and lines) */
export function parseQuotation(body: unknown): QuotationData {
  const input = Input.from(body);
  const text: QuotationData['text'] = {};

  text.client_name = input.requiredString('client_name', 'The client name is required.', { max: 150 });
  text.client_company = input.optionalString('client_company', { max: 150, raw: true });
  text.client_email = input.optionalEmail('client_email');
  text.client_phone = input.optionalString('client_phone', { max: 20, ...PHONE_RULE });

  const gstin = input.raw('client_gstin');
  if (gstin !== undefined) {
    const value = gstin === '' || gstin === null ? null : String(gstin).trim().toUpperCase();
    if (value !== null && value.length !== 15) input.fail('client_gstin', 'A GSTIN is 15 characters.');
    text.client_gstin = value;
  }

  text.client_address = input.optionalString('client_address', { max: 1000, raw: true });
  text.external_reference = input.optionalString('external_reference', { max: 100, raw: true });
  text.notes = input.optionalString('notes', { max: 2000, raw: true });
  text.subject = input.optionalString('subject', { max: 255, raw: true });
  text.details = input.optionalString('details', { max: 5000, raw: true });
  text.scope = input.optionalString('scope', { max: 5000, raw: true });
  text.included_services = input.optionalString('included_services', { max: 5000, raw: true });
  text.terms = input.optionalString('terms', { max: 10000, raw: true });
  text.prepared_by_name = input.optionalString('prepared_by_name', { max: 120, raw: true });
  text.prepared_by_phone = input.optionalString('prepared_by_phone', { max: 30, ...PHONE_RULE });

  const validity = input.oneOf('validity', QUOTATION_VALIDITIES, 'Choose a validity of 15 days, 1 month or a custom number of days.');
  let validityDays: number | null | undefined;
  if (validity === 'custom') {
    validityDays = input.number('validity_days', {
      required: true,
      integer: true,
      min: 1,
      max: MAX_VALIDITY_DAYS,
      message: 'Enter the number of days the quotation is valid for.',
      minMessage: 'A quotation must be valid for at least 1 day.',
      maxMessage: `A quotation can be valid for at most ${MAX_VALIDITY_DAYS} days.`,
    });
  }

  const includeGst = parseIncludeGst(input);
  const leadId = input.optionalId('lead_id', 'The selected lead does not exist.');
  const items = parseItems(input);
  input.done();

  for (const field of TEXT_FIELDS) if (text[field] === undefined) delete text[field];
  return { text, lead_id: leadId, validity, validity_days: validityDays, include_gst: includeGst, items };
}

function parseIncludeGst(input: Input): boolean | undefined {
  const raw = input.raw('include_gst');
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = toBool(raw);
  if (value === undefined) input.fail('include_gst', 'This value must be true or false.');
  return value;
}

/** Price a selection without saving anything */
export function parseCalculation(body: unknown): { include_gst?: boolean; items: QuotationItemInput[] } {
  const input = Input.from(body);
  const includeGst = parseIncludeGst(input);
  const items = parseItems(input);
  input.done();
  return { include_gst: includeGst, items };
}

export function parseStatus(body: unknown): QuotationStatus {
  const input = Input.from(body);
  const status = input.oneOf('status', QUOTATION_STATUSES, 'That is not a valid status.', { required: true });
  input.done();
  return status!;
}

export function parseArtistAssignment(body: unknown): string | null {
  const input = Input.from(body);
  const artistId = input.optionalId('artist_id', 'The selected artist is not available.');
  input.done();
  return artistId ?? null;
}
