'use strict';

const { Router } = require('express');
const { pagoparWebhook, pagoparStatus } = require('../controllers/paymentController');

const router = Router();

// Webhook de Pagopar/upay (publico; se valida con token SHA1 en el controlador).
router.post('/pagopar/webhook', pagoparWebhook);

// Consulta de estado de un pedido por hash (publico; Paso #4 de la doc).
router.get('/pagopar/status/:hash', pagoparStatus);

module.exports = router;
