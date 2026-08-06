'use strict';

const prisma = require('../lib/prisma');

// Comisión del repartidor: 10% del envío (deliveryFee). Igual que conductores,
// cada repartidor tiene su PRIMER MES (30 días desde que se conecta la 1ª vez)
// con 0% de comisión (promo de lanzamiento).
const COMMISSION_LIMIT = 100000;         // tope de comisión adeudada antes de bloquear
const FREE_PERIOD_DAYS = 30;

function isInFreePeriod(user) {
  if (!user || !user.courierFreeUntil) return false;
  return new Date(user.courierFreeUntil).getTime() > Date.now();
}

// 10% del envío, redondeado a la centena.
function calcCommission(deliveryFee) {
  const raw = Number(deliveryFee) * 0.1;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw / 100) * 100;
}

// Comisión a cobrar a ESTE repartidor por un envío: 0 si está en su mes gratis.
function commissionForCourier(user, deliveryFee) {
  if (isInFreePeriod(user)) return 0;
  return calcCommission(deliveryFee);
}

// Arranca el mes gratis la primera vez que el repartidor se conecta (idempotente).
async function startFreePeriod(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { courierFreeUntil: true } });
  if (user && !user.courierFreeUntil) {
    await prisma.user.update({
      where: { id: userId },
      data: { courierFreeUntil: new Date(Date.now() + FREE_PERIOD_DAYS * 24 * 60 * 60 * 1000) },
    });
  }
}

// Suma comisión adeudada al repartidor.
async function addCommission(userId, amount) {
  if (!amount || amount <= 0) return;
  await prisma.user.update({
    where: { id: userId },
    data: { courierCommissionDue: { increment: amount } },
  });
}

// Estado de comisión del repartidor (para la app).
async function getCommission(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { courierCommissionDue: true, courierFreeUntil: true },
  });
  return {
    commissionDue: user ? user.courierCommissionDue : 0,
    limit: COMMISSION_LIMIT,
    freeUntil: user ? user.courierFreeUntil : null,
    inFreePeriod: isInFreePeriod(user),
  };
}

// Al finalizar un envío: acumula la comisión (respetando el mes gratis).
async function chargeOnDelivery(userId, deliveryFee) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { courierFreeUntil: true },
  });
  const commission = commissionForCourier(user, deliveryFee);
  if (commission > 0) await addCommission(userId, commission);
  return commission;
}

module.exports = {
  COMMISSION_LIMIT,
  FREE_PERIOD_DAYS,
  isInFreePeriod,
  calcCommission,
  commissionForCourier,
  startFreePeriod,
  addCommission,
  getCommission,
  chargeOnDelivery,
};
