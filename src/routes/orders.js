'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { listMine, listByBusiness, getOne } = require('../controllers/orderController');

const router = Router();

// Orden importa: rutas estaticas antes que ':id'.
router.get('/mine', requireAuth, listMine);
router.get('/business/:businessId', requireAuth, listByBusiness);
router.get('/:id', requireAuth, getOne);

module.exports = router;
