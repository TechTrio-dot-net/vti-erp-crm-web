import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import { authMiddleware } from '../lib/auth';
import { requireCrmAdmin } from '../lib/crm';
import { sendError } from '../lib/http';

const router = Router();
router.use(authMiddleware, requireCrmAdmin);

/** Tables available from "Download DB". Password hashes and reset tokens are never exported. */
const EXPORTS: Record<string, { label: string; query: string }> = {
  leads: {
    label: 'Leads',
    query: `SELECT l.id, l.company_name AS name, l.phone, l.email, l.city, l.source, l.campaign, l.ad_name, l.form_name, l.platform,
      coalesce(s.name, l.service) AS service, l.stage, l.estimated_value, l.lost_reason, u.name AS assigned_to, l.assigned_at,
      l.first_contact_at, l.last_contact_at, l.next_followup_at, l.closed_at, l.is_manual, l.notes, l.created_at
      FROM leads l LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN services s ON s.id = l.service_id ORDER BY l.created_at DESC`,
  },
  followups: {
    label: 'Lead follow-ups',
    query: `SELECT f.id, l.company_name AS lead, l.phone, u.name AS bdm, f.outcome, f.note, f.next_followup_at, f.created_at
      FROM lead_followups f JOIN leads l ON l.id = f.lead_id LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC`,
  },
  assignments: {
    label: 'Lead assignments & transfers',
    query: `SELECT a.id, l.company_name AS lead, fu.name AS from_bdm, tu.name AS to_bdm, a.reason, a.note, bu.name AS by_user, a.created_at
      FROM lead_assignments a JOIN leads l ON l.id = a.lead_id LEFT JOIN users fu ON fu.id = a.from_user_id
      LEFT JOIN users tu ON tu.id = a.to_user_id LEFT JOIN users bu ON bu.id = a.by_user_id ORDER BY a.created_at DESC`,
  },
  lead_imports: {
    label: 'Google Sheet / Meta raw imports',
    query: `SELECT i.id, src.name AS source, i.external_id, i.status, i.error, i.campaign, i.received_at, i.raw::text AS raw
      FROM lead_imports i JOIN lead_sources src ON src.id = i.source_id ORDER BY i.received_at DESC`,
  },
  clients: { label: 'Clients', query: `SELECT id, company_name, contact_name, contact_email, phone, address, portal_login, created_at FROM clients ORDER BY created_at DESC` },
  projects: { label: 'Projects', query: `SELECT p.id, p.project_name, c.company_name AS client, p.project_status, p.start_date, p.end_date, p.description, p.created_at FROM projects p LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.created_at DESC` },
  tasks: { label: 'Tasks', query: `SELECT t.id, t.title, p.project_name AS project, u.name AS assigned_to, t.status, t.priority, t.deadline, t.completed_at, t.created_at FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assigned_to ORDER BY t.created_at DESC` },
  invoices: { label: 'Invoices', query: `SELECT i.id, i.invoice_number, c.company_name AS client, i.status, i.sub_total, i.total_tax, i.grand_total, i.issue_date, i.due_date, i.paid_at, i.created_at FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ORDER BY i.created_at DESC` },
  users: { label: 'Users (no passwords)', query: `SELECT id, name, username, email, phone, role, is_active, in_rotation, weekly_lead_target, weekly_revenue_target, last_login_at, created_at FROM users ORDER BY name` },
  employees: { label: 'Employees', query: `SELECT e.id, e.employee_code, e.name, e.email, e.phone, d.name AS division, dp.name AS department, dg.name AS designation, e.joining_date, e.monthly_salary, e.status FROM employees e LEFT JOIN divisions d ON d.id = e.division_id LEFT JOIN departments dp ON dp.id = e.department_id LEFT JOIN designations dg ON dg.id = e.designation_id ORDER BY e.name` },
  quotations: {
    label: 'Quotations',
    query: `SELECT q.id, q.quotation_number, q.status, q.client_name, q.client_company, q.client_email, q.client_phone, q.subtotal, q.include_gst, q.tax_amount, q.grand_total, q.amount_paid, q.payment_completed_at, q.valid_until, u.name AS created_by, q.created_at
      FROM quotations q LEFT JOIN users u ON u.id = q.created_by WHERE q.deleted_at IS NULL ORDER BY q.created_at DESC`,
  },
  quotation_items: {
    label: 'Quotation lines',
    query: `SELECT i.id, q.quotation_number, i.description, i.quantity, i.unit, i.duration_minutes, i.unit_price, i.line_total
      FROM quotation_items i JOIN quotations q ON q.id = i.quotation_id WHERE q.deleted_at IS NULL ORDER BY q.created_at DESC, i.sort_order`,
  },
  quotation_payments: {
    label: 'Quotation payments',
    query: `SELECT p.id, q.quotation_number, q.client_name, p.amount, p.received_by, p.method, p.method_detail, p.paid_on, p.reference, p.notes, u.name AS recorded_by, p.created_at
      FROM quotation_payments p JOIN quotations q ON q.id = p.quotation_id LEFT JOIN users u ON u.id = p.recorded_by ORDER BY p.paid_on DESC`,
  },
  pricing_rules: {
    label: 'Pricing rules',
    query: `SELECT r.id, r.name, s.name AS service, a.code AS artist, l.name AS language, sl.name AS source_language, vt.name AS video_type, pf.code AS performer, r.unit, r.base_price, r.cost_price, r.min_quantity, r.priority, r.active
      FROM pricing_rules r JOIN services s ON s.id = r.service_id LEFT JOIN artists a ON a.id = r.artist_id LEFT JOIN languages l ON l.id = r.language_id
      LEFT JOIN languages sl ON sl.id = r.source_language_id LEFT JOIN video_types vt ON vt.id = r.video_type_id LEFT JOIN performers pf ON pf.id = r.performer_id ORDER BY s.name, r.priority DESC`,
  },
  artists: { label: 'Artists', query: `SELECT id, code, name, gender, email, phone, active, deleted_at, created_at FROM artists ORDER BY code` },
  activity_logs: { label: 'Activity log', query: `SELECT l.id, l.created_at, u.name AS user_name, l.event, l.description, l.subject_type, l.ip_address FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC` },
  salaries: { label: 'Monthly salaries', query: `SELECT s.id, e.name AS employee, s.month, s.base_salary, s.working_days, s.paid_days, s.bonus, s.deductions, s.net_pay, s.status, s.paid_at FROM salaries s JOIN employees e ON e.id = s.employee_id ORDER BY s.month DESC, e.name` },
  time_entries: { label: 'Time entries', query: `SELECT te.id, u.name AS user_name, t.title AS task, p.project_name AS project, te.start_time, te.end_time, te.total_minutes, te.notes FROM time_entries te LEFT JOIN users u ON u.id = te.user_id LEFT JOIN tasks t ON t.id = te.task_id LEFT JOIN projects p ON p.id = te.project_id ORDER BY te.start_time DESC` },
};

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralise spreadsheet formula injection and quote when needed
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

router.get('/', (_req, res) => {
  res.json(Object.entries(EXPORTS).map(([key, { label }]) => ({ key, label })));
});

router.get('/:table', async (req, res) => {
  try {
    const def = EXPORTS[req.params.table];
    if (!def) return res.status(404).json({ message: 'Unknown table' });
    const result = await db.execute<Record<string, unknown>>(sql.raw(def.query));
    const columns = result.fields.map((f) => f.name);
    const lines = [columns.join(','), ...result.rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))];
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.table}-${stamp}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) {
    sendError(res, err, 'Export failed');
  }
});

export default router;
