'use strict';

const businessProfileService = require('../services/businessProfileService');

// POST /api/business/apply
// Crea/actualiza el BusinessProfile del usuario (status pending).
async function apply(req, res, next) {
  try {
    const { name, category, address, phone, menu } = req.body || {};

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: 'El nombre del comercio es obligatorio' });
    }
    if (String(name).length > 120) {
      return res.status(400).json({ error: 'El nombre es demasiado largo' });
    }

    const profile = await businessProfileService.applyBusiness(req.user.sub, {
      name: String(name).trim(),
      category,
      address,
      phone,
      menu,
    });

    return res.status(201).json({ profile });
  } catch (err) {
    return next(err);
  }
}

// GET /api/business/me
async function me(req, res, next) {
  try {
    const profile = await businessProfileService.getByOwnerId(req.user.sub);
    return res.json({ profile: profile || null });
  } catch (err) {
    return next(err);
  }
}

module.exports = { apply, me };
