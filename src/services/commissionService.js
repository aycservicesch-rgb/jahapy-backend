'use strict';

// ============================================================
//  COMISION — reporte y confirmacion de pagos (REAL)
//
//  Flujo real y seguro:
//   1) El conductor acumula commissionDue (real, en DriverProfile) por viajes
//      en efectivo (lo hace rideService al completar el viaje).
//   2) El conductor TRANSFIERE al alias de la plataforma y REPORTA el pago
//      -> reportPayment() crea un CommissionPayment 'pending'.
//   3a) Si la API de ueno esta activa, se intenta verificar automaticamente:
//       si coincide -> se confirma solo (descuenta la deuda).
//   3b) Si no, queda pendiente y el ADMIN lo confirma desde el panel.
//   4) confirmPayment() descuenta el monto de commissionDue (piso 0) y
//      desbloquea al conductor. El conductor NUNCA resetea su propia deuda.
// ============================================================

const prisma = require('../lib/prisma');
const uenoPay = require('../lib/uenoPay');
const { COMMISSION_LIMIT } = require('./driverProfileService');

const PAYMENT_STATUSES = ['pending', 'confirmed', 'rejected'];

// Descuenta `amount` de la deuda del conductor, con piso en 0.
async function decreaseDue(driverId, amount) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (!profile) return null;
  const next = Math.max(0, (profile.commissionDue || 0) - Number(amount || 0));
  return prisma.driverProfile.update({
    where: { userId: driverId },
    data: { commissionDue: next },
  });
}

// Estado de comision del conductor: deuda + limite + pagos pendientes.
async function getDriverCommission(driverId) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  const pending = await prisma.commissionPayment.findMany({
    where: { driverId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
  return {
    commissionDue: profile ? profile.commissionDue : 0,
    limit: COMMISSION_LIMIT,
    pending,
  };
}

// El conductor reporta un pago de comision. Crea el registro 'pending' y, si
// ueno esta activo, intenta confirmarlo automaticamente.
// Devuelve { payment, autoConfirmed }.
async function reportPayment(driverId, { amount, reference, method } = {}) {
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return { error: 'El monto debe ser mayor a 0' };
  if (amt > 100000000) return { error: 'Monto invalido' };
  const ref = reference != null ? String(reference).slice(0, 120) : null;
  const mth = method === 'bancard' ? 'bancard' : 'ueno_alias';

  let payment = await prisma.commissionPayment.create({
    data: { driverId, amount: amt, reference: ref, method: mth, status: 'pending' },
  });

  // Verificacion automatica (solo si ueno esta configurado).
  let autoConfirmed = false;
  try {
    const check = await uenoPay.verifyTransfer({ amount: amt, reference: ref });
    if (check.verified) {
      await decreaseDue(driverId, amt);
      payment = await prisma.commissionPayment.update({
        where: { id: payment.id },
        data: {
          status: 'confirmed',
          autoVerified: true,
          reviewedAt: new Date(),
          note: 'Verificado automaticamente por ueno',
        },
      });
      autoConfirmed = true;
    }
  } catch {
    /* si la verificacion falla, queda pendiente para el admin */
  }

  return { payment, autoConfirmed };
}

// Admin: lista pagos por estado (default pending) con datos del conductor.
async function listPayments(status = 'pending') {
  const where = status ? { status } : {};
  const payments = await prisma.commissionPayment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  // Adjuntar datos del conductor + su deuda actual (una consulta por driver).
  const ids = [...new Set(payments.map((p) => p.driverId))];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true, email: true, phone: true },
  });
  const profiles = await prisma.driverProfile.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, commissionDue: true, plate: true },
  });
  const uMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const pMap = Object.fromEntries(profiles.map((p) => [p.userId, p]));
  return payments.map((p) => ({
    ...p,
    driver: uMap[p.driverId] || null,
    commissionDue: pMap[p.driverId] ? pMap[p.driverId].commissionDue : null,
    plate: pMap[p.driverId] ? pMap[p.driverId].plate : null,
  }));
}

// Admin: confirma un pago -> descuenta la deuda del conductor.
async function confirmPayment(paymentId, adminId) {
  const payment = await prisma.commissionPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return { error: 'Pago no encontrado' };
  if (payment.status !== 'pending') return { error: 'El pago ya fue revisado' };

  await decreaseDue(payment.driverId, payment.amount);
  const updated = await prisma.commissionPayment.update({
    where: { id: paymentId },
    data: { status: 'confirmed', reviewedAt: new Date(), reviewedBy: adminId },
  });
  return { payment: updated };
}

// Admin: rechaza un pago (no toca la deuda).
async function rejectPayment(paymentId, adminId, note) {
  const payment = await prisma.commissionPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return { error: 'Pago no encontrado' };
  if (payment.status !== 'pending') return { error: 'El pago ya fue revisado' };

  const updated = await prisma.commissionPayment.update({
    where: { id: paymentId },
    data: {
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedBy: adminId,
      note: note != null ? String(note).slice(0, 200) : 'Rechazado por el admin',
    },
  });
  return { payment: updated };
}

module.exports = {
  PAYMENT_STATUSES,
  getDriverCommission,
  reportPayment,
  listPayments,
  confirmPayment,
  rejectPayment,
};
