'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { report } = require('../controllers/safetyController');

const router = Router();

// Reportar a otro usuario por un problema de seguridad en un viaje.
router.post('/report', requireAuth, report);

module.exports = router;
