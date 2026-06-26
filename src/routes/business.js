'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { apply, me, demoApprove } = require('../controllers/businessController');

const router = Router();

router.post('/apply', requireAuth, apply);
router.get('/me', requireAuth, me);
// DEMO: aprueba el propio comercio sin necesitar un admin.
router.post('/demo-approve', requireAuth, demoApprove);

module.exports = router;
