'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { apply, me, demoApprove, payCommission } = require('../controllers/driverController');

const router = Router();

router.post('/apply', requireAuth, apply);
router.get('/me', requireAuth, me);
// DEMO: aprueba el propio perfil sin necesitar un admin (ver controlador).
router.post('/demo-approve', requireAuth, demoApprove);
router.post('/pay-commission', requireAuth, payCommission);

module.exports = router;
