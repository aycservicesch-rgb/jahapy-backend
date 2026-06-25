'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { listMine, active, getOne } = require('../controllers/rideController');

const router = Router();

// Orden importa: rutas estaticas antes que ':id'.
router.get('/mine', requireAuth, listMine);
router.get('/active', requireAuth, active);
router.get('/:id', requireAuth, getOne);

module.exports = router;
