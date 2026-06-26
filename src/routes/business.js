'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { apply, me } = require('../controllers/businessController');

const router = Router();

router.post('/apply', requireAuth, apply);
router.get('/me', requireAuth, me);

module.exports = router;
