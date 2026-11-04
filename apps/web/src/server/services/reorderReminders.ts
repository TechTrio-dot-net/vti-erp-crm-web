import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import { reorderReminders, type ReminderAction, type ReminderKind } from '../db/schema';
import { APP_TIMEZONE, addDays, todayLocal } from '../lib/crm';

/**
 * Month-by-month re-order reminders for repeat customers.
 *
 * An order is recorded here in two ways, and both count: a lead reaching WON (the first sale), and a
 * payment against a quotation (how a standing customer's next job is usually booked, with no new lead).
 * Orders are bucketed into business-local months and the customer is the client, or their phone number
 * when the sale never became a client record.
 *
 * At the start of a month that gives two lists:
 *  - "reorder" — they ordered last month and the month before, so they order every month, and this
 *    month's order has not come in yet. Ring them for it.
 *  - "winback" — their last order was two months ago and they skipped last month. Ring them and find
 *    out why. Keyed on the month they skipped, so each customer raises this once, not every month after.
 */

/** YYYY-MM of a business-local day */
export const monthOf = (day: string): string => day.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/**
 * The first Saturday of the month — the day the pop-up starts showing. The team looks at the month's
 * re-orders together on a Saturday, so it waits for that day rather than nagging from the 1st.
 */
export function firstSaturday(month: string): string {
  const first = new Date(`${month}-01T00:00:00Z`);
  return addDays(`${month}-01`, (6 - first.getUTCDay() + 7) % 7);
}

export type ReminderRow = {
  customerKey: string;
  leadId: string | null;
  name: string;
  phone: string | null;
  userId: string | null;
  bdmName: string | null;
  kind: ReminderKind;
  lastOrderMonth: string;
  lastOrderAt: string;
  /** Months this customer ordered in over the last year, newest first */
  recentMonths: string[];
};

/** Every order the system knows about, as (customer, business-local month) */
const ORDERS = sql`
  SELECT
    coalesce(l.client_id::text, l.phone_normalized) AS customer_key,
    l.id AS lead_id, l.assigned_to AS user_id, l.company_name AS name, l.phone,
    to_char(coalesce(l.closed_at, l.updated_at) AT TIME ZONE ${APP_TIMEZONE}, 'YYYY-MM') AS month,
    coalesce(l.closed_at, l.updated_at) AS ordered_at
  FROM leads l
  WHERE l.stage = 'WON' AND coalesce(l.client_id::text, l.phone_normalized) IS NOT NULL
  UNION ALL
  SELECT
    coalesce(l.client_id::text, l.phone_normalized, nullif(right(regexp_replace(coalesce(q.client_phone, ''), '\\D', '', 'g'), 10), '')) AS customer_key,
    l.id, coalesce(l.assigned_to, q.created_by), coalesce(l.company_name, q.client_name), coalesce(l.phone, q.client_phone),
    to_char(p.paid_on, 'YYYY-MM'), p.paid_on::timestamptz
  FROM quotation_payments p
  JOIN quotations q ON q.id = p.quotation_id AND q.deleted_at IS NULL
  LEFT JOIN leads l ON l.id = q.lead_id
  WHERE coalesce(l.client_id::text, l.phone_normalized, nullif(right(regexp_replace(coalesce(q.client_phone, ''), '\\D', '', 'g'), 10), '')) IS NOT NULL`;

/**
 * The customers to ring this month, with whatever the BDM has already answered for them left out.
 * `bdm` narrows it to one salesperson's customers — what a BDM sees of it.
 */
export async function dueReminders(params: { month: string; bdm?: string }): Promise<ReminderRow[]> {
  const { month, bdm } = params;
  const previous = addMonths(month, -1);
  const beforeThat = addMonths(month, -2);
  const yearAgo = addMonths(month, -12);
  const { rows } = await db.execute<ReminderRow>(sql`
    WITH orders AS (${ORDERS}),
    latest AS (
      SELECT DISTINCT ON (customer_key) customer_key, lead_id, user_id, name, phone, ordered_at, month
      FROM orders ORDER BY customer_key, ordered_at DESC
    ),
    summary AS (
      SELECT customer_key,
        bool_or(month = ${month}) AS this_month,
        bool_or(month = ${previous}) AS last_month,
        bool_or(month = ${beforeThat}) AS month_before,
        max(month) AS last_order_month,
        array_remove(array_agg(DISTINCT month ORDER BY month DESC) FILTER (WHERE month > ${yearAgo}), NULL) AS recent_months
      FROM orders GROUP BY customer_key
    )
    SELECT
      s.customer_key AS "customerKey", l.lead_id AS "leadId", l.name, l.phone,
      l.user_id AS "userId", u.name AS "bdmName",
      CASE WHEN s.last_month THEN 'reorder' ELSE 'winback' END AS kind,
      s.last_order_month AS "lastOrderMonth", l.ordered_at AS "lastOrderAt",
      s.recent_months AS "recentMonths"
    FROM summary s
    JOIN latest l ON l.customer_key = s.customer_key
    LEFT JOIN users u ON u.id = l.user_id
    WHERE NOT s.this_month
      AND ((s.last_month AND s.month_before) OR s.last_order_month = ${beforeThat})
      AND NOT EXISTS (SELECT 1 FROM reorder_reminders r WHERE r.customer_key = s.customer_key AND r.month_key = ${month})
      ${bdm ? sql`AND l.user_id = ${bdm}` : sql``}
    ORDER BY kind, l.ordered_at DESC`);
  return rows;
}

/** What the BDM answered — called them, or skipped them for this month */
export async function recordReminderAction(params: {
  customerKey: string;
  leadId?: string | null;
  userId: string;
  month: string;
  kind: ReminderKind;
  action: ReminderAction;
  note?: string;
}): Promise<void> {
  await db
    .insert(reorderReminders)
    .values({
      customerKey: params.customerKey,
      leadId: params.leadId ?? null,
      userId: params.userId,
      monthKey: params.month,
      kind: params.kind,
      action: params.action,
      note: params.note,
    })
    .onConflictDoNothing();
}

/** The pop-up's state for whoever is asking: is it open yet, and what is on it */
export async function reminderBoard(bdm?: string): Promise<{
  due: boolean;
  month: string;
  opensOn: string;
  today: string;
  rows: ReminderRow[];
}> {
  const today = todayLocal();
  const month = monthOf(today);
  const opensOn = firstSaturday(month);
  return { due: today >= opensOn, month, opensOn, today, rows: await dueReminders({ month, bdm }) };
}
