'use strict';

const prisma = require('../lib/prisma');

const PROFILE_STATUSES = ['pending', 'approved', 'rejected'];

// Limite de comision adeudada (guaranies). Si se supera, el conductor no puede
// aceptar viajes hasta pagar.
const COMMISSION_LIMIT = 100000;

// Comision: 20% de la tarifa, redondeado a la centena mas cercana.
function calcCommission(fare) {
  const raw = Number(fare) * 0.2;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw / 100) * 100;
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
  return prisma.driverProfile.update({
    where: { userId },
    data: { status: 'approved' },
  });
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
    include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
}

// Admin: cambia el estado de un perfil por userId.
async function setStatus(userId, status) {
  if (!PROFILE_STATUSES.includes(status)) return { error: 'Estado invalido' };
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) return { error: 'Perfil de conductor no encontrado' };
  const updated = await prisma.driverProfile.update({
    where: { userId },
    data: { status },
    include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  return { profile: updated };
}

module.exports = {
  PROFILE_STATUSES,
  COMMISSION_LIMIT,
  calcCommission,
  applyDriver,
  getByUserId,
  demoApprove,
  payCommission,
  addCommission,
  listByStatus,
  setStatus,
};
