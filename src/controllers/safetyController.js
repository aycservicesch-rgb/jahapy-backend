'use strict';

const safetyService = require('../services/safetyService');

// POST /api/safety/report  { reportedId, rideId?, reason, notes?, asRole? }
// El usuario logueado reporta a otro por un problema de seguridad.
async function report(req, res, next) {
  try {
    const { reportedId, rideId, reason, notes, asRole } = req.body || {};
    const result = await safetyService.createReport(req.user.sub, asRole, { reportedId, rideId, reason, notes });
    if (result.error) return res.status(400).json({ error: result.error });
    return res.status(201).json({ ok: true, report: result.report });
  } catch (err) {
    return next(err);
  }
}

module.exports = { report };
