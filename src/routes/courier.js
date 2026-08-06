'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const courierCommissionService = require('../services/courierCommissionService');

const router = Router();

// Estado de comisión del repartidor (deuda + mes gratis).
router.get('/commission', requireAuth, async (req, res, next) => {
  try {
    const data = await courierCommissionService.getCommission(req.user.sub);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
