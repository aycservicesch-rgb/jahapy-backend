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
const pagopar = require('../lib/pagopar');
const { COMMISSION_LIMIT } = require('./driverProfileService');

// Formatea una fecha a 'YYYY-MM-DD HH:mm:ss' (formato que espera Pagopar).
function fmtFecha(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

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
    pagoparEnabled: pagopar.isEnabled(), // ¿hay pago con tarjeta/QR activo?
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

// ---------------- PAGO CON TARJETA / QR (Pagopar / upay) ----------------

// Genera un link de checkout de Pagopar para que el conductor pague su comision
// con tarjeta o QR. Crea un CommissionPayment 'pending' (method 'pagopar') y le
// asocia el hash del pedido. Devuelve { checkoutUrl, paymentId, hash } o { error }.
async function createCommissionCheckout(driverId, { formaPago } = {}) {
  if (!pagopar.isEnabled()) return { error: 'pagopar_disabled' };

  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  const due = profile ? profile.commissionDue : 0;
  if (due <= 0) return { error: 'No tenes comision pendiente' };

  const user = await prisma.user.findUnique({
    where: { id: driverId },
    select: { fullName: true, email: true, phone: true },
  });

  const payment = await prisma.commissionPayment.create({
    data: { driverId, amount: due, method: 'pagopar', status: 'pending' },
  });

  const vencimiento = new Date();
  vencimiento.setHours(vencimiento.getHours() + 24); // 24h para pagar

  const order = await pagopar.createOrder({
    idPedido: payment.id,
    montoTotal: due,
    comprador: {
      nombre: user ? user.fullName : 'Conductor Jahapy',
      email: user ? user.email : '',
      telefono: user ? user.phone : '',
      documento: '',
    },
    items: [{
      ciudad: 1, nombre: 'Comision Jahapy', cantidad: 1, categoria: '909',
      public_key: process.env.PAGOPAR_PUBLIC_KEY || '', url_imagen: '',
      descripcion: 'Comision de viajes', precio_total: due,
    }],
    formaPago,
    fechaMaximaPago: fmtFecha(vencimiento),
  });

  if (!order.ok) {
    await prisma.commissionPayment.update({
      where: { id: payment.id },
      data: { status: 'rejected', note: 'No se pudo generar el link de pago' },
    });
    return { error: 'No se pudo generar el link de pago', detail: order.error };
  }

  await prisma.commissionPayment.update({
    where: { id: payment.id },
    data: { reference: order.hash },
  });

  return { checkoutUrl: order.checkoutUrl, paymentId: payment.id, hash: order.hash };
}

// Confirma un pago Pagopar tras validar el webhook. Doble-verifica el estado
// real contra Pagopar (pagado === true) antes de descontar la deuda.
// Idempotente: si ya estaba confirmado, no hace nada.
async function confirmPagoparPayment(idPedidoComercio, hashPedido) {
  const payment = await prisma.commissionPayment.findUnique({ where: { id: idPedidoComercio } });
  if (!payment) return { error: 'Pago no encontrado' };
  if (payment.status === 'confirmed') return { payment }; // idempotente

  const st = await pagopar.getOrderStatus(hashPedido || payment.reference);
  if (!st.ok || !st.pagado) return { error: 'Pago no confirmado por Pagopar' };

  await decreaseDue(payment.driverId, payment.amount);
  const updated = await prisma.commissionPayment.update({
    where: { id: payment.id },
    data: {
      status: 'confirmed',
      autoVerified: true,
      reviewedAt: new Date(),
      note: 'Pagado con tarjeta/QR (Pagopar)',
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
  createCommissionCheckout,
  confirmPagoparPayment,
};
