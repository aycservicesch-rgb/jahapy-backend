'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { listMine, active, getOne, scheduleRide, listScheduled, cancelScheduled } = require('../controllers/rideController');

const router = Router();

// Orden importa: rutas estaticas antes que ':id'.
router.get('/mine', requireAuth, listMine);
router.get('/active', requireAuth, active);
// Reservas programadas (antes de ':id' para no colisionar).
router.post('/scheduled', requireAuth, scheduleRide);
router.get('/scheduled', requireAuth, listScheduled);
router.post('/scheduled/:id/cancel', requireAuth, cancelScheduled);
router.get('/:id', requireAuth, getOne);

module.exports = router;
