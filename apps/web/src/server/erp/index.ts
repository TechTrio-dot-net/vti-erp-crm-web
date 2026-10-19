import { Router } from 'express';
import { erpAuth } from './context';
import { erpErrorHandler } from './errors';
import accountRoutes from './routes/account';
import adminRoutes from './routes/admin';
import catalogRoutes from './routes/catalog';
import dashboardRoutes from './routes/dashboard';
import lookupRoutes from './routes/lookups';
import paymentRoutes from './routes/payments';
import quotationRoutes from './routes/quotations';

/**
 * Quotations, pricing, payments, the service catalog and administration (roles, settings, activity
 * log), mounted at /api/v1. Every route needs a signed-in user; permissions are checked per route.
 * Responses use snake_case fields, `{ data }` envelopes and `{ data, meta }` pagination.
 */
export function erpRouter(): Router {
  const router = Router();
  router.use(erpAuth);

  router.use(accountRoutes);
  router.use(dashboardRoutes);
  router.use(lookupRoutes);
  router.use('/quotations', quotationRoutes);
  router.use(paymentRoutes);
  router.use(catalogRoutes);
  router.use(adminRoutes);

  router.use((_req, res) => {
    res.status(404).json({ message: 'Not found.' });
  });
  router.use(erpErrorHandler);
  return router;
}
