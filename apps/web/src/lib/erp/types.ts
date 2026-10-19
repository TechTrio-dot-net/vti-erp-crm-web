// Shapes returned by the quotation, catalog and administration API at /api/v1
// (apps/api/src/erp).

/** A record id (UUID), always a string. */
export type Id = string;

export interface Role {
  id: Id;
  name: string;
  slug: string;
  description?: string | null;
  is_system?: boolean;
  users_count?: number;
  permissions?: string[];
}

export interface User {
  id: Id;
  name: string;
  username?: string;
  initials?: string | null;
  email: string | null;
  is_active: boolean;
  last_login_at: string | null;
  /** `slug` is the role users hold (SUPER_ADMIN, SALES, a custom role, …); `id` is null for a role with no record */
  role?: { id: Id | null; name: string; slug: string };
  employee?: { id: Id; employee_code: string; phone: string | null; department: string | null; designation: string | null } | null;
  created_at?: string;
  // Only on the signed-in user's own profile:
  is_super_admin?: boolean;
  permissions?: string[];
}

export interface PaginationMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface Option {
  value: string;
  label: string;
}

// ---- Quotation lookups -------------------------------------------------------

export type ServiceField = "artist_id" | "video_type_id" | "language_id" | "source_language_id";

export interface LookupArtist {
  id: Id;
  code: string;
  /** Kept for admin screens; quotations show the code only. */
  name: string;
  /** Languages the artist performs in; empty = every language. */
  language_ids: Id[];
}

export interface LookupPerformer {
  id: Id;
  code: string;
  /** Kept for admin screens; quotations show the code only. */
  name: string;
}

export interface LookupVideoType {
  id: Id;
  name: string;
  /** True = the line must name a performer; prices differ per performer. */
  requires_performer: boolean;
  /** True = no fixed rate; the price is entered on the quotation. */
  custom_price: boolean;
}

export type PricingUnit = "per_minute" | "per_second" | "per_unit";

export interface LookupService {
  id: Id;
  name: string;
  slug: string;
  description: string | null;
  status: "active" | "coming_soon" | "inactive";
  is_quotable: boolean;
  /** True = only holders of artists.assign may choose this service's artist. */
  artist_restricted: boolean;
  fields: ServiceField[];
  artists: LookupArtist[];
}

export interface QuotationLookups {
  services: LookupService[];
  languages: { id: Id; name: string; code: string | null }[];
  video_types: LookupVideoType[];
  performers: LookupPerformer[];
  durations: { id: Id; label: string; minutes: string }[];
  quantity_presets: number[];
  currency: string;
  tax: { enabled: boolean; label: string; rate: number };
  company: { name: string; address: string; email: string; phone: string; gstin: string; website: string };
  /** Defaults for the editable quotation text. */
  document: { details: string; terms: string };
}

// ---- Quotations --------------------------------------------------------------

export interface QuotationItemInput {
  service_id: Id;
  artist_id?: Id | null;
  language_id?: Id | null;
  source_language_id?: Id | null;
  video_type_id?: Id | null;
  /** Only for video types that require a performer. */
  performer_id?: Id | null;
  duration_id?: Id | null;
  duration_minutes?: number | string | null;
  quantity: number;
  /** A rate replacing the base price, in the rule's unit; required where there is no base price. */
  custom_price?: number | string | null;
}

export interface LineSnapshot {
  service: { id: Id; name: string; slug: string };
  /** Null until coordination assigns an artist. */
  artist: { id: Id; code: string; name: string } | null;
  language: { id: Id; name: string } | null;
  source_language: { id: Id; name: string } | null;
  video_type: { id: Id; name: string } | null;
  /** Absent on lines saved before performers existed. */
  performer?: { id: Id; code: string; name: string } | null;
  duration_label: string;
}

export interface PricedLine extends QuotationItemInput {
  duration_minutes: string;
  unit: PricingUnit;
  unit_price: string;
  /** The pricing rule's price for this selection; null when no rule applies. Internal only. */
  base_price?: string | null;
  /** The price entered on the quotation instead of the base price; null when the base price was used. */
  custom_price?: string | null;
  line_total: string;
  description: string;
  snapshot: LineSnapshot;
}

export interface Calculation {
  items: PricedLine[];
  currency: string;
  subtotal: string;
  tax: { label: string; enabled: boolean; rate: string; amount: string };
  grand_total: string;
}

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "cancelled";
export type QuotationValidity = "15_days" | "1_month" | "custom";

export interface Quotation {
  id: Id;
  quotation_number: string;
  status: QuotationStatus;
  subject: string | null;
  details: string | null;
  scope: string | null;
  included_services: string | null;
  terms: string | null;
  prepared_by_name: string | null;
  prepared_by_phone: string | null;
  validity: QuotationValidity;
  /** Number of days when validity is "custom"; null otherwise. */
  validity_days: number | null;
  client_name: string;
  client_company: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_gstin: string | null;
  client_address: string | null;
  external_reference: string | null;
  /** The CRM lead this quotation was written for */
  lead_id: Id | null;
  currency: string;
  subtotal: string;
  include_gst: boolean;
  tax_rate: string;
  tax_amount: string;
  grand_total: string;
  payment: PaymentSummary;
  notes: string | null;
  valid_until: string | null;
  items_count?: number;
  items?: (PricedLine & { id: Id })[];
  created_by?: { id: Id; name: string } | null;
  created_at: string;
  updated_at: string;
  can: { update: boolean; delete: boolean };
  next_statuses: QuotationStatus[];
}

// ---- Payments ----------------------------------------------------------------

/** unpaid → partial → paid (all received, not yet closed) → completed. */
export type PaymentStatus = "unpaid" | "partial" | "paid" | "completed";

export interface PaymentSummary {
  total: string;
  paid: string;
  pending: string;
  status: PaymentStatus;
  completed_at: string | null;
}

export interface Payment {
  id: Id;
  amount: string;
  received_by: string;
  received_by_label: string;
  method: string;
  /** The method's name; a custom method's own name. */
  method_label: string;
  method_detail?: string | null;
  paid_on: string;
  reference: string | null;
  notes: string | null;
  attachment: { name: string; mime: string; size: number } | null;
  recorded_by: string | null;
  created_at: string | null;
  can_delete: boolean;
}

/** GET /quotations/:id/payments */
export interface QuotationPayments {
  summary: PaymentSummary & { completed_by: string | null; can_record: boolean };
  payments: Payment[];
}

/** GET /payments/options */
export interface PaymentOptions {
  receivers: Option[];
  methods: Option[];
  max_attachment_bytes: number;
}

/** GET /payments */
export interface PaymentsIndex extends Paginated<{
  id: Id;
  quotation_number: string;
  status: QuotationStatus;
  client_name: string;
  client_company: string | null;
  created_by: string | null;
  created_at: string | null;
  payment: PaymentSummary;
}> {
  summary: {
    quotations: number;
    billed: string;
    received: string;
    pending: string;
    unpaid: number;
    partial: number;
    paid: number;
    completed: number;
  };
}

/** GET /quotations/artist-assignments: open quotations with video editing lines that have no editor. */
export interface ArtistAssignments {
  total: number;
  data: {
    id: Id;
    quotation_number: string;
    client_name: string;
    client_company: string | null;
    status: QuotationStatus;
    created_by: string | null;
    created_at: string | null;
    lines: {
      id: Id;
      service_id: Id;
      service: string | null;
      video_type: string | null;
      performer: string | null;
      duration_label: string | null;
      quantity: number;
    }[];
  }[];
}

// ---- Dashboard ---------------------------------------------------------------

export interface DashboardData {
  scope: "company" | "personal";
  metrics: {
    total_employees: number;
    todays_quotations: number;
    pending_quotations: number;
    accepted_quotations: number;
    total_quotation_value: string;
    accepted_quotation_value: string;
  };
  quotations_by_status: { status: QuotationStatus; count: number }[];
  quotations_by_service: { service: string; items: number; total: string }[];
  daily_summary: { date: string; count: number; total: string }[];
  recent_activity: { id: Id; event: string; description: string; user: string | null; created_at: string }[];
}
