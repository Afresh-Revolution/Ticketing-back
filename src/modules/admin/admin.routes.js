import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/authMiddleware.js';
import * as adminController from './admin.controller.js';

const router = Router();

/** Require super admin (id 0 or role superadmin); 403 otherwise. */
function requireSuperAdmin(req, res, next) {
  const role = (req.user?.role || '').toLowerCase();
  const id = req.user?.id;
  if (role === 'superadmin' || id === 0 || id === '0') return next();
  return res.status(403).json({ error: 'Only super admin can access this.' });
}

// All admin routes require auth
router.use(authMiddleware);

// Any authenticated admin
router.get('/dashboard', adminController.getDashboard);
router.get('/events', adminController.listAdminEvents);
router.get('/events/:eventId', adminController.getAdminEvent);
router.get('/events/:eventId/orders', adminController.getEventOrders);
router.get('/sales', adminController.getSales);
router.get('/password-change-status', adminController.getPasswordChangeStatus);

// Super admin only
router.get('/admins', requireSuperAdmin, adminController.listAdmins);
router.delete('/admins/:id', requireSuperAdmin, adminController.deleteAdmin);
router.get('/top-users', requireSuperAdmin, adminController.listTopUsers);
router.post('/top-users', requireSuperAdmin, adminController.createTopUser);
router.patch('/top-users/:id', requireSuperAdmin, adminController.updateTopUser);
router.delete('/top-users/:id', requireSuperAdmin, adminController.deleteTopUser);

export default router;
