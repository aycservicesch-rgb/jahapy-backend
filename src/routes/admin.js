'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const {
  listDrivers,
  approveDriver,
  rejectDriver,
  listBusinesses,
  approveBusiness,
  rejectBusiness,
  listCommissionPayments,
  confirmCommissionPayment,
  rejectCommissionPayment,
} = require('../controllers/adminController');

const router = Router();

// Todas las rutas de admin: auth + rol ADMIN.
router.use(requireAuth, requireAdmin);

// Conductores
router.get('/drivers', listDrivers);
router.post('/drivers/:userId/approve', approveDriver);
router.post('/drivers/:userId/reject', rejectDriver);

// Comercios
router.get('/businesses', listBusinesses);
router.post('/businesses/:id/approve', approveBusiness);
router.post('/businesses/:id/reject', rejectBusiness);

// Pagos de comision (conductores)
router.get('/commission-payments', listCommissionPayments);
router.post('/commission-payments/:id/confirm', confirmCommissionPayment);
router.post('/commission-payments/:id/reject', rejectCommissionPayment);

module.exports = router;
