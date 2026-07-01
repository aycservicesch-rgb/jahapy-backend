'use strict';

const { Router } = require('express');
const { pagoparWebhook } = require('../controllers/paymentController');

const router = Router();

// Webhook de Pagopar/upay (publico; se valida con token SHA1 en el controlador).
router.post('/pagopar/webhook', pagoparWebhook);

module.exports = router;
