import express from 'express';
import { optionalAuth, requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { createRateLimit } from '../../shared/middleware/security.js';
import { query } from '../../shared/config/db.js';
import { flagEnabled } from './access.js';
import {
  collectionBySlug,
  frontendBase,
  listCities,
  listCollections,
  publicEventDetail,
  searchEvents,
  shareHtml,
} from './discover.js';
import {
  acceptCircleInvite,
  acceptPlanInvite,
  addPlanOption,
  blockUser,
  createCircle,
  createPlan,
  exportMine,
  followOrganizer,
  getCircle,
  getNotificationPrefs,
  getPlan,
  inviteToCircle,
  inviteToPlan,
  leaveCircle,
  listCircles,
  listFavorites,
  listFollows,
  listPlans,
  listReviews,
  passportFor,
  previewCircleInvite,
  previewPlanInvite,
  publicPassport,
  redeemPerk,
  reportContent,
  revokeCircleInvite,
  revokePlanInvite,
  rsvpPlan,
  setPassportHidden,
  suggestionsFor,
  toggleFavorite,
  trackAnalytics,
  updateNotificationPrefs,
  upsertReview,
  votePlan,
} from './community.js';
import {
  addMedia,
  announceFollowers,
  approvePerk,
  campaignReport,
  cancelSession,
  createCampaign,
  createPerk,
  generateSessions,
  guestList,
  guestsToCsv,
  invitePromoter,
  inviteStaff,
  issueComp,
  listMedia,
  listSessions,
  listStaff,
  markCommissionPaid,
  metrics,
  moderateMedia,
  moderationQueue,
  promoterDashboard,
  recordClick,
  removeStaff,
  resolveReport,
  reviewVerification,
  setListing,
  setRefundStatus,
  submitVerification,
  suspiciousPromoters,
  verificationPolicy,
} from './organizer.js';
const router = express.Router();
const writeLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: 'Too many requests. Please slow down.',
});
const publicLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many requests. Please slow down.',
});

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      const status = Number(err?.statusCode) || 500;
      if (status >= 500) console.error('[gatewav2]', err);
      const message = status >= 500
        ? 'Something went wrong. Please try again.'
        : (err?.message || 'Request failed');
      res.status(status).json({ error: message });
    });
  };
}

router.get('/flags', asyncRoute(async (_req, res) => {
  const keys = [
    'around_me',
    'organizer_os',
    'distribution',
    'experiences',
    'promoters',
    'plans',
    'passport',
    'post_event',
    'circles',
    'circles_public',
  ];
  const flags = {};
  for (const key of keys) flags[key] = await flagEnabled(key);
  res.json({ flags, pilotCity: 'jos' });
}));

router.get('/cities', publicLimit, asyncRoute(async (_req, res) => {
  res.json({ cities: await listCities(), pilot: 'jos' });
}));

router.get('/discover', publicLimit, asyncRoute(async (req, res) => {
  if (!(await flagEnabled('around_me'))) return res.status(404).json({ error: 'Discovery is disabled' });
  const result = await searchEvents(req.query || {});
  res.json(result);
}));

router.get('/collections', publicLimit, asyncRoute(async (_req, res) => {
  res.json({ collections: await listCollections() });
}));

router.get('/collections/:slug', publicLimit, asyncRoute(async (req, res) => {
  const collection = await collectionBySlug(req.params.slug);
  if (!collection) return res.status(404).json({ error: 'Collection not found' });
  res.json(collection);
}));

router.get('/events/:id/public', publicLimit, asyncRoute(async (req, res) => {
  const event = await publicEventDetail(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
}));

router.get('/events/:id/share', publicLimit, asyncRoute(async (req, res) => {
  const event = await publicEventDetail(req.params.id);
  if (!event) return res.status(404).type('html').send('<p>Event not found</p>');
  res.type('html').send(shareHtml(event));
}));

router.get('/events/:id/sessions', publicLimit, asyncRoute(async (req, res) => {
  res.json({ sessions: await listSessions(req.params.id), timezoneNote: 'Times are stored in UTC and labeled in the event timezone. Nigeria (Africa/Lagos) does not observe DST.' });
}));

router.get('/events/:id/reviews', publicLimit, asyncRoute(async (req, res) => {
  res.json(await listReviews(req.params.id));
}));

router.get('/events/:id/media', publicLimit, asyncRoute(async (req, res) => {
  res.json({ photos: await listMedia(req.params.id) });
}));

router.get('/verification-policy', (_req, res) => {
  res.json(verificationPolicy());
});

router.get('/sitemap.xml', publicLimit, asyncRoute(async (_req, res) => {
  const base = frontendBase();
  const cities = await listCities();
  const collections = await listCollections();
  const events = await searchEvents({ page: 1, pageSize: 30 });
  const urls = [
    `${base}/#/events`,
    ...cities.map((c) => `${base}/#/city/${c.slug}`),
    ...collections.map((c) => `${base}/#/collections/${c.slug}`),
    ...events.events.map((e) => `${base}/#/event/${e.id}`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((loc) => `  <url><loc>${loc.replace(/&/g, '&amp;')}</loc></url>`)
    .join('\n')}\n</urlset>`;
  res.type('application/xml').send(xml);
}));

router.get('/invites/plan/:token', publicLimit, asyncRoute(async (req, res) => {
  res.json(await previewPlanInvite(req.params.token));
}));

router.get('/invites/circle/:token', publicLimit, asyncRoute(async (req, res) => {
  res.json(await previewCircleInvite(req.params.token));
}));

router.post('/analytics', publicLimit, optionalAuth, asyncRoute(async (req, res) => {
  res.json(await trackAnalytics(req, req.body || {}));
}));

router.post('/promoters/click', publicLimit, asyncRoute(async (req, res) => {
  const shareCode = String(req.body?.shareCode || '').trim();
  if (!shareCode) return res.status(400).json({ error: 'shareCode is required' });
  res.json(await recordClick(shareCode, req.body?.anonId));
}));

router.post('/favorites/:eventId', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await toggleFavorite(req, req.params.eventId, true));
}));
router.delete('/favorites/:eventId', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await toggleFavorite(req, req.params.eventId, false));
}));
router.get('/favorites', requireAuth, asyncRoute(async (req, res) => {
  res.json({ events: await listFavorites(req) });
}));

router.post('/follows', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await followOrganizer(req, req.body || {}, true));
}));
router.delete('/follows', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await followOrganizer(req, req.body || {}, false));
}));
router.get('/follows', requireAuth, asyncRoute(async (req, res) => {
  res.json({ follows: await listFollows(req) });
}));
router.get('/suggestions', requireAuth, asyncRoute(async (req, res) => {
  res.json(await suggestionsFor(req));
}));

router.get('/notifications', requireAuth, asyncRoute(async (req, res) => {
  res.json(await getNotificationPrefs(req));
}));
router.patch('/notifications', requireAuth, asyncRoute(async (req, res) => {
  res.json(await updateNotificationPrefs(req, req.body || {}));
}));

router.get('/plans', requireAuth, asyncRoute(async (req, res) => {
  res.json({ plans: await listPlans(req) });
}));
router.post('/plans', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await createPlan(req, req.body || {}));
}));
router.get('/plans/:id', requireAuth, asyncRoute(async (req, res) => {
  res.json(await getPlan(req, req.params.id));
}));
router.post('/plans/:id/options', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await addPlanOption(req, req.params.id, req.body || {}));
}));
router.post('/plans/:id/votes/:optionId', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await votePlan(req, req.params.id, req.params.optionId, String(req.body?.choice || '')));
}));
router.post('/plans/:id/rsvp', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await rsvpPlan(req, req.params.id, String(req.body?.rsvp || ''), req.body?.sharePayment));
}));
router.post('/plans/:id/invites', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await inviteToPlan(req, req.params.id));
}));
router.post('/plans/:id/invites/:token/revoke', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await revokePlanInvite(req, req.params.id, req.params.token));
}));
router.post('/invites/plan/:token/accept', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await acceptPlanInvite(req, req.params.token));
}));

router.get('/circles', requireAuth, asyncRoute(async (req, res) => {
  res.json({ circles: await listCircles(req) });
}));
router.post('/circles', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await createCircle(req, req.body || {}));
}));
router.get('/circles/:id', requireAuth, asyncRoute(async (req, res) => {
  res.json(await getCircle(req, req.params.id));
}));
router.post('/circles/:id/invites', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await inviteToCircle(req, req.params.id));
}));
router.post('/circles/:id/invites/:token/revoke', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await revokeCircleInvite(req, req.params.id, req.params.token));
}));
router.post('/circles/:id/leave', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await leaveCircle(req, req.params.id));
}));
router.post('/invites/circle/:token/accept', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await acceptCircleInvite(req, req.params.token, req.body?.adultConfirmed === true));
}));
router.post('/blocks', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await blockUser(req, req.body?.userId));
}));
router.post('/reports', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await reportContent(req, req.body || {}));
}));

router.get('/passport', requireAuth, asyncRoute(async (req, res) => {
  res.json(await passportFor(req));
}));
router.patch('/passport', requireAuth, asyncRoute(async (req, res) => {
  res.json(await setPassportHidden(req, req.body?.hidden !== false));
}));
router.get('/passport/:userId/summary', asyncRoute(async (req, res) => {
  res.json(await publicPassport(Number(req.params.userId)));
}));
router.post('/perks/:id/redeem', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await redeemPerk(req, req.params.id));
}));
router.get('/me/export', requireAuth, asyncRoute(async (req, res) => {
  res.json(await exportMine(req));
}));

router.post('/events/:id/reviews', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await upsertReview(req, req.params.id, req.body || {}));
}));

router.post('/events/:id/sessions/generate', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await generateSessions(req, req.params.id, req.body || {}));
}));
router.post('/events/:id/sessions/:sessionId/cancel', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await cancelSession(req, req.params.id, req.params.sessionId, req.body?.reason));
}));
router.post('/events/:id/listing', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await setListing(req, req.params.id, String(req.body?.status || '')));
}));
router.get('/events/:id/staff', requireAuth, asyncRoute(async (req, res) => {
  res.json({ staff: await listStaff(req, req.params.id) });
}));
router.post('/events/:id/staff', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json({ staff: await inviteStaff(req, req.params.id, req.body || {}) });
}));
router.delete('/events/:id/staff/:userId', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await removeStaff(req, req.params.id, req.params.userId));
}));
router.get('/events/:id/guests', requireAuth, asyncRoute(async (req, res) => {
  const guests = await guestList(req, req.params.id);
  if (String(req.query.format || '') === 'csv') {
    res.type('text/csv').send(guestsToCsv(guests));
    return;
  }
  res.json({ guests });
}));
router.post('/events/:id/comps', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await issueComp(req, req.params.id, req.body || {}));
}));
router.post('/orders/:id/refund-status', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await setRefundStatus(req, req.params.id, req.body || {}));
}));
router.post('/events/:id/campaigns', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await createCampaign(req, req.params.id, req.body || {}));
}));
router.get('/events/:id/campaigns', requireAuth, asyncRoute(async (req, res) => {
  res.json({ campaigns: await campaignReport(req, req.params.id) });
}));
router.post('/campaigns/:id/promoters', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await invitePromoter(req, req.params.id, req.body || {}));
}));
router.get('/promoters/me', requireAuth, asyncRoute(async (req, res) => {
  res.json(await promoterDashboard(req));
}));
router.post('/events/:id/media', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await addMedia(req, req.params.id, req.body || {}));
}));
router.post('/media/:id/moderate', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await moderateMedia(req, req.params.id, req.body?.status));
}));
router.post('/events/:id/announce', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.json(await announceFollowers(req, req.params.id, req.body || {}));
}));
router.post('/perks', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await createPerk(req, req.body || {}));
}));
router.post('/verification', writeLimit, requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json(await submitVerification(req, req.body || {}));
}));

router.get('/admin/moderation', requireAuth, requireSuperAdmin, asyncRoute(async (_req, res) => {
  res.json(await moderationQueue());
}));
router.post('/admin/reports/:id', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  res.json(await resolveReport(req, req.params.id, req.body?.status));
}));
router.post('/admin/verification/:id', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  res.json(await reviewVerification(req, req.params.id, req.body || {}));
}));
router.post('/admin/perks/:id', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  res.json(await approvePerk(req, req.params.id, req.body?.approved !== false));
}));
router.post('/admin/commissions/:id/paid', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  res.json(await markCommissionPaid(req, req.params.id));
}));
router.get('/admin/promoters/suspicious', requireAuth, requireSuperAdmin, asyncRoute(async (_req, res) => {
  res.json({ spikes: await suspiciousPromoters() });
}));
router.get('/admin/metrics', requireAuth, requireSuperAdmin, asyncRoute(async (_req, res) => {
  res.json(await metrics());
}));
router.post('/admin/collections/:slug/events', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  const collection = await query(`SELECT id FROM "CuratedCollection" WHERE slug = $1`, [req.params.slug]);
  if (!collection.rows?.length) return res.status(404).json({ error: 'Collection not found' });
  const eventId = String(req.body?.eventId || '');
  if (!eventId) return res.status(400).json({ error: 'eventId is required' });
  const { createId } = await import('../../shared/config/db.js');
  await query(
    `INSERT INTO "CollectionEvent" (id, "collectionId", "eventId", "sortOrder")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("collectionId", "eventId") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder"`,
    [createId(), collection.rows[0].id, eventId, Number(req.body?.sortOrder) || 0],
  );
  res.json(await collectionBySlug(req.params.slug));
}));

router.get('/staff/can-scan/:eventId', requireAuth, asyncRoute(async (req, res) => {
  const { eventRole } = await import('./access.js');
  const access = await eventRole(req, req.params.eventId);
  res.json({
    allowed: ['superadmin', 'owner', 'manager', 'checkin'].includes(access.role),
    role: access.role,
  });
}));

export default router;
