'use strict';

const prisma = require('../lib/prisma');
const driverProfileService = require('../services/driverProfileService');
const commissionService = require('../services/commissionService');

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

// GET /api/driver/commission  -> { commissionDue, limit, pending: [...] }
async function getCommission(req, res, next) {
  try {
    const data = await commissionService.getDriverCommission(req.user.sub);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

// POST /api/driver/pay-commission  { amount, reference? }
// El conductor REPORTA que transfirio su comision al alias. NO resetea su
// propia deuda: crea un pago 'pending' que el admin confirma (o la API de ueno
// verifica automaticamente). Devuelve { payment, autoConfirmed, commission }.
async function reportCommission(req, res, next) {
  try {
    const { amount, reference, method } = req.body || {};
    const result = await commissionService.reportPayment(req.user.sub, {
      amount,
      reference,
      method,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    const commission = await commissionService.getDriverCommission(req.user.sub);
    return res.status(201).json({
      payment: result.payment,
      autoConfirmed: result.autoConfirmed,
      commission,
    });
  } catch (err) {
    return next(err);
  }
}

// POST /api/driver/commission/checkout  { formaPago? }
// Genera un link de pago (Pagopar/upay) para pagar la comision con tarjeta/QR.
// Si Pagopar no esta configurado, responde { enabled:false } (sin error).
async function commissionCheckout(req, res, next) {
  try {
    const pagopar = require('../lib/pagopar');
    if (!pagopar.isEnabled()) return res.json({ enabled: false });
    const { formaPago } = req.body || {};
    const result = await commissionService.createCommissionCheckout(req.user.sub, { formaPago });
    if (result.error) return res.status(400).json({ enabled: true, error: result.error });
    return res.json({ enabled: true, ...result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { apply, me, demoApprove, getCommission, reportCommission, commissionCheckout };
