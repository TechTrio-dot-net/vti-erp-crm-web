import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index';
import {
  PAYMENT_METHODS,
  PAYMENT_RECEIVERS,
  quotationPayments,
  quotations,
  type PaymentAttachment,
  type PaymentMethod,
  type PaymentReceiver,
  type QuotationStatus,
} from '../../db/schema';
import { HttpError, isUuid } from '../../lib/http';
import { MAX_UPLOAD_BYTES, deleteObject, getObject, putObject } from '../../lib/storage';
import { logActivity } from '../activity';
import { erpUser, type ErpUser } from '../context';
import { dec, money } from '../decimal';
import { ValidationError, authorize, conflict, notFound } from '../errors';
import { Input, likePattern, meta, pageQuery, searchTerm } from '../input';
import { paymentSummary } from '../paymentSummary';
import { findQuotation, policy, userNames, visibleTo, type QuotationRow } from '../quotations';
import { dayIn } from '../time';

const router = Router();

/** 5 MB, or just under Vercel's 4.5 MB request limit when hosted there */
export const MAX_ATTACHMENT_BYTES = Math.min(5 * 1024 * 1024, MAX_UPLOAD_BYTES);
const TOO_LARGE = `The screenshot may not be larger than ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`;

/** Quotations that can take payments */
const PAYABLE: QuotationStatus[] = ['draft', 'sent', 'accepted'];

/**
 * Accepted proof-of-payment files, recognised by their first bytes rather than the name or type the
 * browser claims — what is served back later is exactly what it says it is.
 */
const SIGNATURES: { mime: string; extension: string; matches: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', extension: '.jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', extension: '.png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', extension: '.webp', matches: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'application/pdf', extension: '.pdf', matches: (b) => b.toString('ascii', 0, 5) === '%PDF-' },
];

async function saveAttachment(file: Express.Multer.File): Promise<PaymentAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw ValidationError.of({ attachment: TOO_LARGE });
  const type = SIGNATURES.find((signature) => signature.matches(file.buffer));
  if (!type) throw ValidationError.of({ attachment: 'Attach a JPG, PNG or WebP image, or a PDF.' });

  const relative = `payments/${randomUUID()}${type.extension}`;
  await putObject(relative, file.buffer, type.mime);
  return { file: relative, name: file.originalname.slice(0, 200) || `attachment${type.extension}`, mime: type.mime, size: file.size };
}

async function removeAttachment(attachment: PaymentAttachment | null): Promise<void> {
  if (attachment) await deleteObject(attachment.file);
}

// The hard cap is above what the storage accepts, so an oversized file gets a field error instead of a bare 413
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES * 2, files: 1 } });
function uploadAttachment(req: Request, res: Response, next: NextFunction) {
  upload.single('attachment')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(
        ValidationError.of({
          attachment: err.code === 'LIMIT_FILE_SIZE' ? TOO_LARGE : 'Attach a single screenshot of the payment.',
        })
      );
    }
    next(err);
  });
}

/** Who may remove a payment: whoever recorded it, or anyone who can edit quotations */
const mayDelete = (payment: { recordedBy: string | null }, user: ErpUser) => user.can('quotations.update') || payment.recordedBy === user.id;

/** A quotation the user may track payments on */
async function payableQuotation(id: string, user: ErpUser): Promise<QuotationRow> {
  const quotation = await findQuotation(id);
  authorize(user.can('payments.record') && policy.view(user, quotation));
  return quotation;
}

async function paymentWithQuotation(id: string, user: ErpUser) {
  const [payment] = isUuid(id) ? await db.select().from(quotationPayments).where(eq(quotationPayments.id, id)).limit(1) : [];
  if (!payment) throw notFound('Payment');
  return { payment, quotation: await payableQuotation(payment.quotationId, user) };
}

/** A quotation's payments, newest first, with its totals */
async function forQuotation(q: QuotationRow, user: ErpUser) {
  const payments = await db
    .select()
    .from(quotationPayments)
    .where(eq(quotationPayments.quotationId, q.id))
    .orderBy(desc(quotationPayments.paidOn), desc(quotationPayments.createdAt));
  const names = await userNames([...payments.map((p) => p.recordedBy), q.paymentCompletedBy]);

  return {
    summary: {
      ...paymentSummary(q),
      completed_by: names.get(q.paymentCompletedBy ?? '') ?? null,
      can_record: PAYABLE.includes(q.status) && !q.paymentCompletedAt,
    },
    payments: payments.map((p) => ({
      id: p.id,
      amount: money(p.amount),
      received_by: p.receivedBy,
      received_by_label: PAYMENT_RECEIVERS[p.receivedBy] ?? p.receivedBy,
      method: p.method,
      method_label: p.method === 'custom' ? (p.methodDetail ?? PAYMENT_METHODS.custom) : (PAYMENT_METHODS[p.method] ?? p.method),
      paid_on: p.paidOn,
      reference: p.reference,
      notes: p.notes,
      attachment: p.attachment ? { name: p.attachment.name, mime: p.attachment.mime, size: p.attachment.size } : null,
      recorded_by: names.get(p.recordedBy ?? '') ?? null,
      created_at: p.createdAt.toISOString(),
      can_delete: !q.paymentCompletedAt && mayDelete(p, user),
    })),
  };
}

/** Re-sum the quotation's payments, so the stored total can never drift */
async function recalculate(quotationId: string, tx: Pick<typeof db, 'select' | 'update'> = db): Promise<void> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${quotationPayments.amount}), 0)` })
    .from(quotationPayments)
    .where(eq(quotationPayments.quotationId, quotationId));
  await tx.update(quotations).set({ amountPaid: money(row?.total ?? 0) }).where(eq(quotations.id, quotationId));
}

function assertOpen(q: QuotationRow): void {
  if (!PAYABLE.includes(q.status)) throw conflict(`Payments cannot be recorded on a ${q.status} quotation.`);
  if (q.paymentCompletedAt) throw conflict('This payment is marked complete. Reopen it to record another payment.');
}

// ─── Status filters and totals ───────────────────────────────────────────────

const PAID = sql`coalesce(${quotations.amountPaid}, 0)`;
const NOT_COMPLETED = isNull(quotations.paymentCompletedAt);
const STATUS_FILTERS: Record<'pending' | 'unpaid' | 'partial' | 'paid' | 'completed', SQL> = {
  pending: and(NOT_COMPLETED, sql`${PAID} < ${quotations.grandTotal}`)!,
  unpaid: and(NOT_COMPLETED, sql`${PAID} <= 0`)!,
  partial: and(NOT_COMPLETED, sql`${PAID} > 0`, sql`${PAID} < ${quotations.grandTotal}`)!,
  paid: and(NOT_COMPLETED, sql`${PAID} > 0`, sql`${PAID} >= ${quotations.grandTotal}`)!,
  completed: isNotNull(quotations.paymentCompletedAt),
};
const countWhere = (condition: SQL) => sql<number>`count(*) filter (where ${condition})::int`;

router.get('/payments/options', (_req, res) => {
  const list = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
  res.json({ data: { receivers: list(PAYMENT_RECEIVERS), methods: list(PAYMENT_METHODS), max_attachment_bytes: MAX_ATTACHMENT_BYTES } });
});

/** The payments list: quotations out with clients, and any other open quotation with money against it */
router.get('/payments', async (req, res) => {
  const user = erpUser(req);
  authorize(user.can('payments.record') && policy.viewAny(user));

  const input = Input.from(req.query);
  const status = input.oneOf('status', ['pending', 'unpaid', 'partial', 'paid', 'completed'] as const, 'That is not a valid payment status.');
  input.done();
  const { page, perPage } = pageQuery(req.query, { perPage: 15, maxPerPage: 100 });
  const search = searchTerm(req.query);

  const base = and(
    visibleTo(user),
    isNull(quotations.deletedAt),
    inArray(quotations.status, PAYABLE),
    or(inArray(quotations.status, ['sent', 'accepted']), sql`${PAID} > 0`)
  );
  const where = and(
    base,
    status ? STATUS_FILTERS[status] : undefined,
    search
      ? or(ilike(quotations.quotationNumber, likePattern(search)), ilike(quotations.clientName, likePattern(search)), ilike(quotations.clientCompany, likePattern(search)))
      : undefined
  );

  const [rows, [{ total }], [totals]] = await Promise.all([
    db.select().from(quotations).where(where).orderBy(desc(quotations.createdAt), desc(quotations.id)).limit(perPage).offset((page - 1) * perPage),
    db.select({ total: count() }).from(quotations).where(where),
    db
      .select({
        quotations: sql<number>`count(*)::int`,
        billed: sql<string>`coalesce(sum(${quotations.grandTotal}), 0)`,
        received: sql<string>`coalesce(sum(${PAID}), 0)`,
        pending: sql<string>`coalesce(sum(case when ${quotations.paymentCompletedAt} is not null then 0 else greatest(${quotations.grandTotal} - ${PAID}, 0) end), 0)`,
        unpaid: countWhere(STATUS_FILTERS.unpaid),
        partial: countWhere(STATUS_FILTERS.partial),
        paid: countWhere(STATUS_FILTERS.paid),
        completed: countWhere(STATUS_FILTERS.completed),
      })
      .from(quotations)
      .where(base),
  ]);
  const names = await userNames(rows.map((q) => q.createdBy));

  res.json({
    data: rows.map((q) => ({
      id: q.id,
      quotation_number: q.quotationNumber,
      status: q.status,
      client_name: q.clientName,
      client_company: q.clientCompany,
      created_by: names.get(q.createdBy ?? '') ?? null,
      created_at: q.createdAt.toISOString(),
      payment: paymentSummary(q),
    })),
    meta: meta(page, perPage, Number(total), rows.length),
    summary: {
      quotations: Number(totals?.quotations ?? 0),
      billed: money(totals?.billed ?? 0),
      received: money(totals?.received ?? 0),
      pending: money(totals?.pending ?? 0),
      unpaid: Number(totals?.unpaid ?? 0),
      partial: Number(totals?.partial ?? 0),
      paid: Number(totals?.paid ?? 0),
      completed: Number(totals?.completed ?? 0),
    },
  });
});

router.get('/quotations/:id/payments', async (req, res) => {
  const user = erpUser(req);
  const quotation = await payableQuotation((req.params.id as string), user);
  res.json({ data: await forQuotation(quotation, user) });
});

/** Sent as multipart form data (it carries the screenshot), so every field arrives as text */
router.post('/quotations/:id/payments', uploadAttachment, async (req, res) => {
  const user = erpUser(req);
  const quotation = await payableQuotation((req.params.id as string), user);

  const input = Input.from(req.body);
  const amount = input.number('amount', {
    required: true,
    decimals: 2,
    min: 0.01,
    max: 9999999999,
    message: 'Enter the amount received.',
    minMessage: 'The amount must be more than zero.',
    maxMessage: 'The amount is too large.',
  });
  const receivedBy = input.oneOf('received_by', Object.keys(PAYMENT_RECEIVERS), 'Choose who received the payment.', { required: true }) as PaymentReceiver;
  const method = input.oneOf('method', Object.keys(PAYMENT_METHODS), 'Choose how the payment was made.', { required: true }) as PaymentMethod;
  let methodDetail: string | null = null;
  if (method === 'custom') {
    methodDetail = input.requiredString('method_detail', 'Enter how the payment was made.', { max: 60 });
  }
  const paidOn = input.date('paid_on', { strict: true, required: true, message: 'Enter the date of the payment.' });
  const reference = input.optionalString('reference', { max: 100 }) ?? null;
  const notes = input.optionalString('notes', { max: 1000 }) ?? null;
  input.done();

  assertOpen(quotation);
  const value = dec(amount).toDecimalPlaces(2);
  const pending = dec(paymentSummary(quotation).pending);
  if (pending.lte(0)) throw ValidationError.of({ amount: 'This quotation is already fully paid.' });
  if (value.gt(pending)) throw ValidationError.of({ amount: `Only ₹${money(pending)} is pending on this quotation.` });
  if (paidOn! > dayIn(new Date())) throw ValidationError.of({ paid_on: 'The payment date cannot be in the future.' });
  // Every payment needs its proof
  if (!req.file) throw ValidationError.of({ attachment: 'Attach a screenshot of the payment.' });

  // Stored first so a rejected file never leaves a payment without its proof
  const attachment = await saveAttachment(req.file);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(quotationPayments).values({
        quotationId: quotation.id,
        amount: money(value),
        receivedBy,
        method,
        methodDetail,
        paidOn: paidOn!,
        reference,
        notes,
        attachment,
        recordedBy: user.id,
      });
      await recalculate(quotation.id, tx);
    });
  } catch (error) {
    await removeAttachment(attachment);
    throw error;
  }

  await logActivity(
    req,
    'payment_recorded',
    `₹${money(value)} received on quotation ${quotation.quotationNumber} (${PAYMENT_RECEIVERS[receivedBy]})`,
    { id: quotation.id, type: 'Quotation' },
    { amount: money(value), received_by: receivedBy, method }
  );
  res.status(201).json({ data: await forQuotation(await findQuotation(quotation.id), user) });
});

/** Close the account once everything is received */
router.post('/quotations/:id/payments/complete', async (req, res) => {
  const user = erpUser(req);
  const quotation = await payableQuotation((req.params.id as string), user);
  const summary = paymentSummary(quotation);
  if (summary.status !== 'completed') {
    if (summary.status !== 'paid') throw conflict(`₹${summary.pending} is still pending. Record the full payment before marking it complete.`);
    await db.update(quotations).set({ paymentCompletedAt: new Date(), paymentCompletedBy: user.id }).where(eq(quotations.id, quotation.id));
    await logActivity(req, 'payment_completed', `Payment for quotation ${quotation.quotationNumber} marked complete`, { id: quotation.id, type: 'Quotation' }, {
      amount_paid: money(quotation.amountPaid),
    });
  }
  res.status(201).json({ data: await forQuotation(await findQuotation(quotation.id), user) });
});

router.delete('/quotations/:id/payments/complete', async (req, res) => {
  const user = erpUser(req);
  const quotation = await payableQuotation((req.params.id as string), user);
  if (quotation.paymentCompletedAt) {
    await db.update(quotations).set({ paymentCompletedAt: null, paymentCompletedBy: null }).where(eq(quotations.id, quotation.id));
    await logActivity(req, 'payment_reopened', `Payment for quotation ${quotation.quotationNumber} reopened`, { id: quotation.id, type: 'Quotation' }, {
      amount_paid: money(quotation.amountPaid),
    });
  }
  res.json({ data: await forQuotation(await findQuotation(quotation.id), user) });
});

router.delete('/payments/:id', async (req, res) => {
  const user = erpUser(req);
  const { payment, quotation } = await paymentWithQuotation((req.params.id as string), user);
  authorize(mayDelete(payment, user));
  if (quotation.paymentCompletedAt) throw conflict('This payment is marked complete. Reopen it before removing a payment.');

  await db.transaction(async (tx) => {
    await tx.delete(quotationPayments).where(eq(quotationPayments.id, payment.id));
    await recalculate(quotation.id, tx);
  });
  await removeAttachment(payment.attachment);
  await logActivity(req, 'payment_removed', `₹${money(payment.amount)} payment removed from quotation ${quotation.quotationNumber}`, { id: quotation.id, type: 'Quotation' }, {
    amount: money(payment.amount),
    paid_on: payment.paidOn,
  });
  res.json({ data: await forQuotation(await findQuotation(quotation.id), user) });
});

/** The proof-of-payment file, shown inline (only images and PDFs are ever stored) */
router.get('/payments/:id/attachment', async (req, res) => {
  const user = erpUser(req);
  const { payment } = await paymentWithQuotation((req.params.id as string), user);
  const stored = payment.attachment ? await getObject(payment.attachment.file) : null;
  if (!payment.attachment || !stored) throw new HttpError(404, 'This payment has no attachment.');
  res.set({
    'Content-Type': payment.attachment.mime,
    'Content-Disposition': `inline; filename="${payment.attachment.name.replace(/[^\w.\- ]+/g, '_')}"`,
    'Cache-Control': 'private, max-age=3600',
  });
  stored.stream.pipe(res);
});

export default router;
