'use strict';

const driverProfileService = require('../services/driverProfileService');
const businessProfileService = require('../services/businessProfileService');

const STATUS_FILTERS = ['pending', 'approved', 'rejected'];

// ---------------------- CONDUCTORES ----------------------

// GET /api/admin/drivers?status=pending
async function listDrivers(req, res, next) {
  try {
    const status = req.query.status;
    if (status && !STATUS_FILTERS.includes(status)) {
      return res.status(400).json({ error: 'status invalido' });
    }
    const drivers = await driverProfileService.listByStatus(status);
    return res.json({ drivers });
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/drivers/:userId/approve
async function approveDriver(req, res, next) {
  try {
    const result = await driverProfileService.setStatus(req.params.userId, 'approved');
    if (result.error) return res.status(404).json({ error: result.error });
    return res.json({ profile: result.profile });
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/drivers/:userId/reject
async function rejectDriver(req, res, next) {
  try {
    const result = await driverProfileService.setStatus(req.params.userId, 'rejected');
    if (result.error) return res.status(404).json({ error: result.error });
    return res.json({ profile: result.profile });
  } catch (err) {
    return next(err);
  }
}

// ---------------------- COMERCIOS ----------------------

// GET /api/admin/businesses?status=pending
async function listBusinesses(req, res, next) {
  try {
    const status = req.query.status;
    if (status && !STATUS_FILTERS.includes(status)) {
      return res.status(400).json({ error: 'status invalido' });
    }
    const businesses = await businessProfileService.listByStatus(status);
    return res.json({ businesses });
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/businesses/:id/approve
async function approveBusiness(req, res, next) {
  try {
    const result = await businessProfileService.setStatus(req.params.id, 'approved');
    if (result.error) return res.status(404).json({ error: result.error });
    return res.json({ profile: result.profile });
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/businesses/:id/reject
async function rejectBusiness(req, res, next) {
  try {
    const result = await businessProfileService.setStatus(req.params.id, 'rejected');
    if (result.error) return res.status(404).json({ error: result.error });
    return res.json({ profile: result.profile });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listDrivers,
  approveDriver,
  rejectDriver,
  listBusinesses,
  approveBusiness,
  rejectBusiness,
};
