'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { me } = require('../controllers/userController');

const router = Router();

router.get('/me', requireAuth, me);

module.exports = router;
