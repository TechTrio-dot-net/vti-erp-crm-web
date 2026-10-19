import { Router } from 'express';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { invoices, type InvoiceItem } from '../db/schema';
import { authMiddleware, requirePermission, AuthRequest } from '../lib/auth';
import { HttpError, pickColumns, sendError, uuidParam } from '../lib/http';
import { pick } from '../lib/scopes';
import { toApi } from '../lib/serialize';

const router = Router();
router.use(authMiddleware);
router.param('id', uuidParam);

const EDITABLE_FIELDS = [
  'clientId',
  'projectId',
  'currency',
  'status',
  'issueDate',
  'dueDate',
  'items',
  'notes',
  'placeOfSupply',
  'isIntraState',
  'gstExempt',
] as const;

const STATUSES = ['draft', 'sent', 'paid', 'overdue'] as const;

/** Sent invoices past their due date become overdue — one cheap UPDATE before reading */
async function markOverdue(): Promise<void> {
  await db
    .update(invoices)
    .set({ status: 'overdue' })
    .where(and(eq(invoices.status, 'sent'), isNotNull(invoices.dueDate), lt(invoices.dueDate, sql`now()`)));
}

function validateStatus(status: unknown) {
  if (status !== undefined && !STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new HttpError(400, 'Invalid invoice status');
  }
}

async function nextInvoiceNumber(): Promise<string> {
  const [last] = await db
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  // Only the trailing sequence counts — "TT/2026-27/0007" → 7
  const lastSeq = last ? parseInt(last.invoiceNumber.match(/(\d+)\s*$/)?.[1] ?? '0', 10) : 0;
  const year = new Date().getFullYear();
  return `TT/${year}-${String(year + 1).slice(2)}/${String(lastSeq + 1).padStart(4, '0')}`;
}

function calcTotals(items: Array<{ quantity: number; rate: number; gstRate?: number; name?: string }>, isIntraState: boolean, gstExempt: boolean) {
  let subTotal = 0;
  let totalTax = 0;
  const calculated = items.map((item) => {
    const taxableValue = (item.quantity || 1) * (item.rate || 0);
    subTotal += taxableValue;
    const gstRate = item.gstRate ?? 18;
    let igst = 0, cgst = 0, sgst = 0, total = taxableValue;
    if (!gstExempt) {
      if (isIntraState) {
        cgst = parseFloat(((taxableValue * gstRate) / 200).toFixed(2));
        sgst = parseFloat(((taxableValue * gstRate) / 200).toFixed(2));
        total = taxableValue + cgst + sgst;
        totalTax += cgst + sgst;
      } else {
        igst = parseFloat(((taxableValue * gstRate) / 100).toFixed(2));
        total = taxableValue + igst;
        totalTax += igst;
      }
    }
    return { ...item, calculated: { taxableValue, igst, cgst, sgst, total } };
  });
  return { subTotal: parseFloat(subTotal.toFixed(2)), totalTax: parseFloat(totalTax.toFixed(2)), grandTotal: parseFloat((subTotal + totalTax).toFixed(2)), calculated };
}

function findInvoice(id: string) {
  return db.query.invoices.findFirst({
    where: eq(invoices.id, id),
    with: { client: pick.clientName, project: pick.projectName },
  });
}

router.get('/', requirePermission('clients', 'read'), async (_req: AuthRequest, res) => {
  try {
    await markOverdue();
    const rows = await db.query.invoices.findMany({
      columns: { id: true, invoiceNumber: true, grandTotal: true, amount: true, status: true, issueDate: true, dueDate: true, paidAt: true },
      with: { client: pick.clientName },
      orderBy: [desc(invoices.createdAt)],
    });
    res.json(
      rows.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        amount: i.grandTotal ?? i.amount,
        status: i.status,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        paidAt: i.paidAt,
        clientProfile: toApi(i.client),
      }))
    );
  } catch (err) {
    sendError(res, err, 'Failed to fetch invoices');
  }
});

router.get('/:id', requirePermission('clients', 'read'), async (req: AuthRequest, res) => {
  try {
    await markOverdue();
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, req.params.id as string),
      with: {
        client: { columns: { id: true, companyName: true, contactName: true, contactEmail: true, phone: true, address: true } },
        project: pick.projectName,
      },
    });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    res.json(toApi(invoice));
  } catch (err) {
    sendError(res, err, 'Failed to fetch invoice');
  }
});

router.post('/', requirePermission('clients', 'create'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const values = pickColumns(invoices, req.body, EDITABLE_FIELDS);
    if (!values.clientId) throw new HttpError(400, 'Client is required');
    const validItems = ((values.items ?? []) as InvoiceItem[]).filter((it) => it?.name?.trim() && Number(it.rate) > 0);
    if (validItems.length === 0) throw new HttpError(400, 'Add at least one line item with a name and rate');
    values.items = validItems;

    const intraState = values.isIntraState ?? true;
    const exempt = values.gstExempt ?? false;
    const lineItems = (values.items ?? []) as InvoiceItem[];
    const { subTotal, totalTax, grandTotal } = calcTotals(lineItems, intraState, exempt);

    // invoice_number is unique; retry if a concurrent request took the same number
    let created: { id: string } | undefined;
    for (let attempt = 0; !created; attempt++) {
      try {
        [created] = await db
          .insert(invoices)
          .values({
            ...values,
            clientId: values.clientId,
            invoiceNumber: await nextInvoiceNumber(),
            amount: grandTotal,
            currency: values.currency || 'INR',
            status: 'draft',
            issueDate: values.issueDate ?? new Date(),
            items: lineItems,
            notes: values.notes || undefined,
            placeOfSupply: values.placeOfSupply || 'Gujarat',
            isIntraState: intraState,
            gstExempt: exempt,
            subTotal,
            totalTax,
            grandTotal,
            createdBy: authReq.user!.id,
          })
          .returning({ id: invoices.id });
      } catch (err) {
        const code = (err as { cause?: { code?: string } })?.cause?.code;
        if (code !== '23505' || attempt >= 4) throw err;
      }
    }
    res.status(201).json(toApi((await findInvoice(created.id))!));
  } catch (err) {
    sendError(res, err, 'Failed to create invoice');
  }
});

router.patch('/:id', requirePermission('clients', 'update'), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const id = req.params.id as string;
    const updates: Partial<typeof invoices.$inferInsert> = {
      ...pickColumns(invoices, req.body, EDITABLE_FIELDS),
      updatedBy: authReq.user!.id,
    };
    validateStatus(updates.status);

    const [current] = await db
      .select({ status: invoices.status, isIntraState: invoices.isIntraState, gstExempt: invoices.gstExempt })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    if (!current) return res.status(404).json({ message: 'Invoice not found' });

    if (updates.status && updates.status !== current.status) {
      updates.paidAt = updates.status === 'paid' ? new Date() : null;
    }

    // Recalculate totals when items or tax settings change, falling back to the stored settings
    if (updates.items || updates.isIntraState !== undefined || updates.gstExempt !== undefined) {
      const items =
        updates.items ??
        ((await db.select({ items: invoices.items }).from(invoices).where(eq(invoices.id, id)).limit(1))[0]?.items || []);
      const { subTotal, totalTax, grandTotal } = calcTotals(
        items,
        updates.isIntraState ?? current.isIntraState,
        updates.gstExempt ?? current.gstExempt
      );
      Object.assign(updates, { subTotal, totalTax, grandTotal, amount: grandTotal });
    }

    await db.update(invoices).set(updates).where(eq(invoices.id, id));
    res.json(toApi((await findInvoice(id))!));
  } catch (err) {
    sendError(res, err, 'Failed to update invoice');
  }
});

router.delete('/:id', requirePermission('clients', 'delete'), async (req, res) => {
  try {
    const [deleted] = await db.delete(invoices).where(eq(invoices.id, req.params.id as string)).returning({ id: invoices.id });
    if (!deleted) return res.status(404).json({ message: 'Invoice not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, 'Failed to delete invoice');
  }
});

export default router;
