import { sql } from 'drizzle-orm';
import { db } from '../db/index';

/** The old CRM can log the same enquiry a little later than this CRM (its own sheet import, or a BDM typing it in) */
const SAME_ENQUIRY_WINDOW = '2 days';

/**
 * One customer, one lead, one BDM while both CRMs run side by side. The Google Sheet feeds both, so the same
 * enquiry arrives here and in the old CRM. A lead made here is folded into the old CRM's lead for the same
 * number when that lead is the same enquiry (logged no earlier than two days before it): the old CRM's lead
 * keeps its BDM and history, and gets everything done here — follow-ups, calls, messages, quotations, the
 * sheet row. A number whose old CRM lead is an earlier, finished enquiry is a new enquiry and is left alone.
 */
export async function mergeIntoOldCrmLeads(): Promise<number> {
  return db.transaction(async (tx) => {
    const pairs = await tx.execute<{ dup: string; keep: string }>(sql`
      SELECT DISTINCT ON (l.id) l.id AS dup, o.id AS keep
      FROM leads l JOIN leads o ON o.phone_normalized = l.phone_normalized AND o.external_id LIKE 'legacy-crm:%'
        AND o.created_at >= l.created_at - ${SAME_ENQUIRY_WINDOW}::interval
      WHERE l.phone_normalized IS NOT NULL AND (l.external_id IS NULL OR l.external_id NOT LIKE 'legacy-crm:%')
      ORDER BY l.id, o.created_at ASC`);
    if (!pairs.rows.length) return 0;
    const map = sql`(VALUES ${sql.join(pairs.rows.map((p) => sql`(${p.dup}::uuid, ${p.keep}::uuid)`), sql`, `)}) AS m(dup, keep)`;
    for (const table of ['lead_followups', 'call_logs', 'whatsapp_logs', 'dial_requests', 'quotations']) {
      await tx.execute(sql`UPDATE ${sql.identifier(table)} t SET lead_id = m.keep FROM ${map} WHERE t.lead_id = m.dup`);
    }
    await tx.execute(sql`UPDATE lead_imports t SET lead_id = m.keep, status = 'duplicate' FROM ${map} WHERE t.lead_id = m.dup`);
    // Work done here counts on the old CRM's lead: first and last contact, and the next follow-up if it is later
    await tx.execute(sql`
      UPDATE leads o SET
        first_contact_at = least(o.first_contact_at, d.first_contact_at),
        last_contact_at = greatest(o.last_contact_at, d.last_contact_at),
        next_followup_at = CASE WHEN d.last_contact_at > coalesce(o.last_contact_at, '-infinity') THEN d.next_followup_at ELSE o.next_followup_at END
      FROM ${map} JOIN leads d ON d.id = m.dup WHERE o.id = m.keep AND d.last_contact_at IS NOT NULL`);
    await tx.execute(sql`DELETE FROM leads l USING ${map} WHERE l.id = m.dup`);
    return pairs.rows.length;
  });
}
