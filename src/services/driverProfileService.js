'use strict';

const prisma = require('../lib/prisma');

const PROFILE_STATUSES = ['pending', 'approved', 'rejected'];

// Limite de comision adeudada (guaranies). Si se supera, el conductor no puede
// aceptar viajes hasta pagar.
const COMMISSION_LIMIT = 100000;

// PROMO DE LANZAMIENTO: cada conductor tiene sus primeros 30 dias (desde que se
// aprueba su perfil) con 0% de comision. Pasado ese plazo, vuelve al 10%.
const FREE_PERIOD_DAYS = 30;

// ¿El conductor esta dentro de su mes gratis? (freeUntil futuro)
function isInFreePeriod(profile) {
  if (!profile || !profile.freeUntil) return false;
  return new Date(profile.freeUntil).getTime() > Date.now();
}

// Comision: 10% de la tarifa (tarifa de lanzamiento), redondeado a la centena.
function calcCommission(fare) {
  const raw = Number(fare) * 0.1;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw / 100) * 100;
}

// Comision a cobrar a ESTE conductor por una tarifa: 0 si esta en su mes gratis.
function commissionForDriver(profile, fare) {
  if (isInFreePeriod(profile)) return 0;
  return calcCommission(fare);
}

// Fecha de fin del mes gratis a partir de ahora.
function freeUntilFromNow() {
  return new Date(Date.now() + FREE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}

// Crea o actualiza el DriverProfile del usuario con los datos del vehiculo.
// Al (re)aplicar, queda en estado 'pending'.
async function applyDriver(userId, data = {}) {
  const vehicle = {
    vehicleType: data.vehicleType ? String(data.vehicleType) : null,
    brand: data.brand ? String(data.brand) : null,
    model: data.model ? String(data.model) : null,
    year: Number.isInteger(data.year) ? data.year : null,
    plate: data.plate ? String(data.plate) : null,
    docs: data.docs != null ? JSON.stringify(data.docs) : null,
  };

  return prisma.driverProfile.upsert({
    where: { userId },
    update: { ...vehicle, status: 'pending' },
    create: { userId, status: 'pending', commissionDue: 0, ...vehicle },
  });
}

async function getByUserId(userId) {
  return prisma.driverProfile.findUnique({ where: { userId } });
}

// DEMO: aprueba el perfil del propio usuario (status -> 'approved').
// En produccion esto lo hace un admin via setStatus; este atajo existe para
// que el flujo de la demo funcione sin un admin real.
async function demoApprove(userId) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) return null;
  // Al aprobar por primera vez, arranca su mes gratis (0% comision).
  const data = { status: 'approved' };
  if (!profile.freeUntil) data.freeUntil = freeUntilFromNow();
  return prisma.driverProfile.update({ where: { userId }, data });
}

async function payCommission(userId) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) return null;
  return prisma.driverProfile.update({
    where: { userId },
    data: { commissionDue: 0 },
  });
}

// Suma comision adeudada al conductor (pago simulado: se acumula la deuda).
async function addCommission(userId, amount) {
  if (!amount || amount <= 0) return null;
  return prisma.driverProfile.update({
    where: { userId },
    data: { commissionDue: { increment: amount } },
  });
}

// Admin: lista de perfiles por estado (default pending).
async function listByStatus(status) {
  const where = status ? { status } : {};
  return prisma.driverProfile.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, fullName: true, email: true, phone: true, city: true } } },
  });
}

// Admin: cambia el estado de un perfil por userId.
async function setStatus(userId, status) {
  if (!PROFILE_STATUSES.includes(status)) return { error: 'Estado invalido' };
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) return { error: 'Perfil de conductor no encontrado' };
  const data = { status };
  // Al aprobar por primera vez, arranca su mes gratis (0% comision).
  if (status === 'approved' && !profile.freeUntil) data.freeUntil = freeUntilFromNow();
  const updated = await prisma.driverProfile.update({
    where: { userId },
    data,
    include: { user: { select: { id: true, fullName: true, email: true, phone: true, city: true } } },
  });
  return { profile: updated };
}

module.exports = {
  PROFILE_STATUSES,
  COMMISSION_LIMIT,
  FREE_PERIOD_DAYS,
  calcCommission,
  commissionForDriver,
  isInFreePeriod,
  applyDriver,
  getByUserId,
  demoApprove,
  payCommission,
  addCommission,
  listByStatus,
  setStatus,
};
