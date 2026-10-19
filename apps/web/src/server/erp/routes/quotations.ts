import { Router } from 'express';
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '../../db/index';
import { QUOTATION_STATUSES, quotations, type QuotationStatus } from '../../db/schema';
import { erpUser } from '../context';
import { authorize } from '../errors';
import { Input, likePattern, meta, pageQuery, searchTerm } from '../input';
import { calculate } from '../pricing';
import { parseArtistAssignment, parseCalculation, parseQuotation, parseStatus } from '../quotationInput';
import {
  abilities,
  assignArtist,
  assignedArtistIds,
  changeStatus,
  createQuotation,
  findQuotation,
  itemCounts,
  pendingArtistAssignments,
  policy,
  removeQuotation,
  serializeQuotation,
  stripReservedArtists,
  updateQuotation,
  userNames,
  visibleTo,
  withRelations,
} from '../quotations';
import { endOfDay, startOfDay } from '../time';

const router = Router();

/** Index filters: `?status=draft,sent` (what the dashboard's pending card links to), search, from/to days */
function indexFilters(query: Record<string, unknown>) {
  const input = Input.from(query);
  let statuses: QuotationStatus[] | undefined;
  if (typeof query.status === 'string' && query.status.trim()) {
    statuses = query.status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as QuotationStatus[];
    if (!statuses.every((s) => QUOTATION_STATUSES.includes(s))) input.fail('status', 'That is not a valid status.');
  }
  const from = input.date('from', { message: 'Enter a valid date.' });
  const to = input.date('to', { message: 'Enter a valid date.' });
  const leadId = input.optionalId('lead_id', 'Choose a valid lead.');
  input.done();
  return { statuses, from: from?.slice(0, 10), to: to?.slice(0, 10), search: searchTerm(query), leadId };
}

router.get('/', async (req, res) => {
  const user = erpUser(req);
  authorize(policy.viewAny(user));

  const { page, perPage } = pageQuery(req.query, { perPage: 15, maxPerPage: 100 });
  const { statuses, from, to, search, leadId } = indexFilters(req.query);
  const where = and(
    isNull(quotations.deletedAt),
    visibleTo(user),
    // The quotations written for one CRM lead (shown on the lead)
    leadId ? eq(quotations.leadId, leadId) : undefined,
    statuses?.length ? inArray(quotations.status, statuses) : undefined,
    search
      ? or(
          ilike(quotations.quotationNumber, likePattern(search)),
          ilike(quotations.clientName, likePattern(search)),
          ilike(quotations.clientCompany, likePattern(search))
        )
      : undefined,
    from ? gte(quotations.createdAt, startOfDay(from)) : undefined,
    to ? lte(quotations.createdAt, endOfDay(to)) : undefined
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(quotations)
      .where(where)
      .orderBy(desc(quotations.createdAt), desc(quotations.id))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: count() }).from(quotations).where(where),
  ]);
  const [counts, names] = await Promise.all([itemCounts(rows.map((q) => q.id)), userNames(rows.map((q) => q.createdBy))]);

  res.json({
    data: rows.map((q) =>
      serializeQuotation(q, {
        itemsCount: counts.get(q.id) ?? 0,
        creator: q.createdBy && names.has(q.createdBy) ? { id: q.createdBy, name: names.get(q.createdBy)! } : null,
        can: abilities(user, q),
      })
    ),
    meta: meta(page, perPage, Number(total), rows.length),
  });
});

/** Price a selection without saving anything (drives the live calculation summary) */
router.post('/calculate', async (req, res) => {
  const user = erpUser(req);
  authorize(policy.create(user));
  const dto = parseCalculation(req.body);
  const items = await stripReservedArtists(dto.items, user);
  res.json({ data: await calculate(items, dto.include_gst ?? true) });
});

router.post('/', async (req, res) => {
  const user = erpUser(req);
  authorize(policy.create(user));
  const dto = parseQuotation(req.body);
  dto.items = await stripReservedArtists(dto.items, user);
  const quotation = await createQuotation(req, dto, user);
  res.status(201).json({ data: await withRelations(quotation, user) });
});

/** Lines still waiting for coordination to assign the video editor (dashboard) */
router.get('/artist-assignments', async (req, res) => {
  const user = erpUser(req);
  authorize(user.can('artists.assign') && policy.viewAny(user));
  res.json(await pendingArtistAssignments(user));
});

router.patch('/:id/items/:itemId/artist', async (req, res) => {
  const user = erpUser(req);
  const quotation = await findQuotation((req.params.id as string));
  authorize(user.can('artists.assign') && policy.view(user, quotation));
  await assignArtist(req, quotation, (req.params.itemId as string), parseArtistAssignment(req.body), user);
  res.json({ data: await withRelations(await findQuotation(quotation.id), user) });
});

router.get('/:id', async (req, res) => {
  const user = erpUser(req);
  const quotation = await findQuotation((req.params.id as string));
  authorize(policy.view(user, quotation));
  res.json({ data: await withRelations(quotation, user) });
});

router.put('/:id', async (req, res) => {
  const user = erpUser(req);
  const quotation = await findQuotation((req.params.id as string));
  authorize(policy.update(user, quotation));
  const dto = parseQuotation(req.body);
  dto.items = await stripReservedArtists(dto.items, user, await assignedArtistIds(quotation));
  const updated = await updateQuotation(req, quotation, dto, user);
  res.json({ data: await withRelations(updated, user) });
});

router.patch('/:id/status', async (req, res) => {
  const user = erpUser(req);
  const quotation = await findQuotation((req.params.id as string));
  authorize(policy.update(user, quotation));
  const status = parseStatus(req.body);
  const updated = await changeStatus(req, quotation, status, user);
  res.json({ data: await withRelations(updated, user) });
});

router.delete('/:id', async (req, res) => {
  const user = erpUser(req);
  const quotation = await findQuotation((req.params.id as string));
  authorize(policy.delete(user, quotation));
  await removeQuotation(req, quotation);
  res.status(204).end();
});

export default router;
