'use strict';

const prisma = require('../lib/prisma');
const driverProfileService = require('../services/driverProfileService');

// POST /api/driver/apply
// Crea/actualiza el DriverProfile del usuario (status pending) con los datos
// del vehiculo. Si el usuario no era DRIVER, pasa su rol a DRIVER.
async function apply(req, res, next) {
  try {
    const { vehicleType, brand, model, year, plate, docs } = req.body || {};

    if (!vehicleType || !plate) {
      return res.status(400).json({ error: 'vehicleType y plate son obligatorios' });
    }
    if (String(plate).length > 20) {
      return res.status(400).json({ error: 'La patente es demasiado larga' });
    }
    if (year != null && (!Number.isInteger(year) || year < 1950 || year > 2100)) {
      return res.status(400).json({ error: 'El ano del vehiculo no es valido' });
    }

    const userId = req.user.sub;
    const profile = await driverProfileService.applyDriver(userId, {
      vehicleType,
      brand,
      model,
      year,
      plate,
      docs,
    });

    // Asegurar rol DRIVER.
    if (req.user.role !== 'DRIVER') {
      await prisma.user.update({ where: { id: userId }, data: { role: 'DRIVER' } });
    }

    return res.status(201).json({ profile });
  } catch (err) {
    return next(err);
  }
}

// GET /api/driver/me
async function me(req, res, next) {
  try {
    const profile = await driverProfileService.getByUserId(req.user.sub);
    return res.json({ profile: profile || null });
  } catch (err) {
    return next(err);
  }
}

// POST /api/driver/demo-approve  (DEMO)
// Aprueba el DriverProfile DEL PROPIO usuario logueado (status -> 'approved').
// Es un atajo de demo; en produccion la aprobacion la hace un admin.
async function demoApprove(req, res, next) {
  try {
    const profile = await driverProfileService.demoApprove(req.user.sub);
    if (!profile) {
      return res.status(404).json({
        error: 'No tenes un perfil de conductor. Postula primero con /api/driver/apply',
      });
    }
    return res.json({ profile });
  } catch (err) {
    return next(err);
  }
}

// POST /api/driver/pay-commission  (pago simulado: resetea commissionDue a 0)
async function payCommission(req, res, next) {
  try {
    const profile = await driverProfileService.payCommission(req.user.sub);
    if (!profile) {
      return res.status(404).json({ error: 'No tenes un perfil de conductor' });
    }
    return res.json({ profile });
  } catch (err) {
    return next(err);
  }
}

module.exports = { apply, me, demoApprove, payCommission };
