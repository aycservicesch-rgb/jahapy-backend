'use strict';

const rideService = require('../services/rideService');

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

module.exports = { listMine, active, getOne };
