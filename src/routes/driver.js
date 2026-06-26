'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { apply, me, payCommission } = require('../controllers/driverController');

const router = Router();

router.post('/apply', requireAuth, apply);
router.get('/me', requireAuth, me);
router.post('/pay-commission', requireAuth, payCommission);

module.exports = router;
