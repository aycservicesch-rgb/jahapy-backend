'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { apply, me, demoApprove, getCommission, reportCommission, commissionCheckout } = require('../controllers/driverController');

const router = Router();

router.post('/apply', requireAuth, apply);
router.get('/me', requireAuth, me);
// DEMO: aprueba el propio perfil sin necesitar un admin (ver controlador).
router.post('/demo-approve', requireAuth, demoApprove);
// Comision: ver deuda/pagos pendientes y REPORTAR un pago (no auto-resetea).
router.get('/commission', requireAuth, getCommission);
router.post('/pay-commission', requireAuth, reportCommission);
// Pago de comision con tarjeta/QR (Pagopar/upay): genera link de checkout.
router.post('/commission/checkout', requireAuth, commissionCheckout);

module.exports = router;
