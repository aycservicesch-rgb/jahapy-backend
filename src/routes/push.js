'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const push = require('../lib/push');

const router = express.Router();

// Llave pública VAPID (no es secreta) — el frontend la usa para suscribirse.
router.get('/vapid', (req, res) => {
  res.json({ publicKey: push.publicKey, enabled: push.enabled });
});

// Guardar la suscripción push del usuario (conductor/repartidor/comercio).
router.post('/subscribe', requireAuth, (req, res) => {
  const ok = push.saveSubscription(req.user.sub, req.body && req.body.subscription);
  if (!ok) return res.status(400).json({ error: 'Suscripción inválida' });
  res.json({ ok: true });
});

// Eliminar la suscripción (al desactivar notificaciones).
router.post('/unsubscribe', requireAuth, (req, res) => {
  push.removeSubscription(req.user.sub);
  res.json({ ok: true });
});

module.exports = router;
