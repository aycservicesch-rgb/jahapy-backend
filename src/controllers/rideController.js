'use strict';

const rideService = require('../services/rideService');
const scheduledRideService = require('../services/scheduledRideService');

// GET /api/rides/mine
async function listMine(req, res, next) {
  try {
    const rides = await rideService.listMyRides(req.user.sub);
    return res.json({ rides });
  } catch (err) {
    return next(err);
  }
}

// GET /api/rides/active
async function active(req, res, next) {
  try {
    const ride = await rideService.getActiveRide(req.user.sub);
    return res.json({ ride });
  } catch (err) {
    return next(err);
  }
}

// GET /api/rides/:id  (solo si el usuario es parte del viaje)
async function getOne(req, res, next) {
  try {
    const ride = await rideService.getRideById(req.params.id);
    if (!ride) {
      return res.status(404).json({ error: 'Viaje no encontrado' });
    }
    if (ride.passengerId !== req.user.sub && ride.driverId !== req.user.sub) {
      return res.status(403).json({ error: 'No tenes acceso a este viaje' });
    }
    return res.json({ ride });
  } catch (err) {
    return next(err);
  }
}

// ---------------- RESERVAS PROGRAMADAS ----------------

// POST /api/rides/scheduled  { origin, dest, scheduledFor, rideType?, fare?, ... }
async function scheduleRide(req, res, next) {
  try {
    const result = await scheduledRideService.create(req.user.sub, req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    return res.status(201).json({ scheduled: result.ride });
  } catch (err) {
    return next(err);
  }
}

// GET /api/rides/scheduled  -> reservas futuras del pasajero
async function listScheduled(req, res, next) {
  try {
    const scheduled = await scheduledRideService.listUpcoming(req.user.sub);
    return res.json({ scheduled });
  } catch (err) {
    return next(err);
  }
}

// POST /api/rides/scheduled/:id/cancel
async function cancelScheduled(req, res, next) {
  try {
    const result = await scheduledRideService.cancel(req.params.id, req.user.sub);
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json({ scheduled: result.ride });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listMine, active, getOne, scheduleRide, listScheduled, cancelScheduled };
