'use strict';

const prisma = require('../lib/prisma');

// Métricas generales del negocio para el dashboard del CRM.
async function getStats() {
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);

  const [
    usersByRole,
    ridesTotal, ridesCompleted, ridesToday,
    ordersTotal, ordersDelivered,
    driversByStatus,
    bizByStatus,
    commissionDue, commissionCollected,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.ride.count(),
    prisma.ride.count({ where: { status: 'COMPLETED' } }),
    prisma.ride.count({ where: { createdAt: { gte: startToday } } }),
    prisma.foodOrder.count(),
    prisma.foodOrder.count({ where: { status: 'DELIVERED' } }),
    prisma.driverProfile.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.businessProfile.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.driverProfile.aggregate({ _sum: { commissionDue: true } }),
    prisma.commissionPayment.aggregate({ where: { status: 'confirmed' }, _sum: { amount: true } }),
  ]);

  const roleCount = (r) => (usersByRole.find((x) => x.role === r)?._count._all || 0);
  const statusCount = (arr, s) => (arr.find((x) => x.status === s)?._count._all || 0);
  const usersTotal = usersByRole.reduce((a, x) => a + x._count._all, 0);

  return {
    users: {
      total: usersTotal,
      passengers: roleCount('PASSENGER'),
      drivers: roleCount('DRIVER'),
      couriers: roleCount('COURIER'),
      admins: roleCount('ADMIN'),
    },
    rides: { total: ridesTotal, completed: ridesCompleted, today: ridesToday },
    orders: { total: ordersTotal, delivered: ordersDelivered },
    drivers: {
      approved: statusCount(driversByStatus, 'approved'),
      pending: statusCount(driversByStatus, 'pending'),
      rejected: statusCount(driversByStatus, 'rejected'),
    },
    businesses: {
      approved: statusCount(bizByStatus, 'approved'),
      pending: statusCount(bizByStatus, 'pending'),
    },
    commission: {
      due: commissionDue._sum.commissionDue || 0,       // adeudada por conductores
      collected: commissionCollected._sum.amount || 0,  // cobrada (pagos confirmados)
    },
  };
}

// Lista de usuarios (clientes) con búsqueda + rol, con agregados de actividad.
async function listUsers({ search = '', role = '', take = 60 } = {}) {
  const where = {};
  if (role) where.role = role;
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(take) || 60, 200),
    select: { id: true, fullName: true, email: true, phone: true, role: true, city: true, createdAt: true },
  });
  const ids = users.map((u) => u.id);

  const [rideAgg, orderAgg] = await Promise.all([
    prisma.ride.groupBy({
      by: ['passengerId'],
      where: { passengerId: { in: ids }, status: 'COMPLETED' },
      _count: { _all: true }, _sum: { fare: true },
    }),
    prisma.foodOrder.groupBy({
      by: ['customerId'],
      where: { customerId: { in: ids } },
      _count: { _all: true }, _sum: { total: true },
    }),
  ]);
  const rMap = Object.fromEntries(rideAgg.map((r) => [r.passengerId, r]));
  const oMap = Object.fromEntries(orderAgg.map((o) => [o.customerId, o]));

  return users.map((u) => ({
    ...u,
    rides: rMap[u.id]?._count._all || 0,
    orders: oMap[u.id]?._count._all || 0,
    spent: (rMap[u.id]?._sum.fare || 0) + (oMap[u.id]?._sum.total || 0),
  }));
}

// Detalle de un usuario: datos + historial + notas del CRM.
async function getUserDetail(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, email: true, phone: true, role: true, city: true, rating: true, createdAt: true },
  });
  if (!user) return null;

  const [ridesAsPassenger, ridesAsDriver, orders, notes, driverProfile] = await Promise.all([
    prisma.ride.findMany({ where: { passengerId: userId }, orderBy: { createdAt: 'desc' }, take: 15,
      select: { id: true, status: true, originLabel: true, destLabel: true, fare: true, createdAt: true } }),
    prisma.ride.findMany({ where: { driverId: userId }, orderBy: { createdAt: 'desc' }, take: 15,
      select: { id: true, status: true, originLabel: true, destLabel: true, fare: true, createdAt: true } }),
    prisma.foodOrder.findMany({ where: { customerId: userId }, orderBy: { createdAt: 'desc' }, take: 15,
      select: { id: true, status: true, total: true, address: true, createdAt: true } }),
    prisma.userNote.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.driverProfile.findUnique({ where: { userId } }),
  ]);

  return { user, ridesAsPassenger, ridesAsDriver, orders, notes, driverProfile };
}

// Agrega una nota del CRM sobre un usuario.
async function addNote(userId, authorId, text) {
  const clean = String(text || '').trim().slice(0, 1000);
  if (!clean) return { error: 'La nota está vacía' };
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) return { error: 'Usuario no encontrado' };
  const note = await prisma.userNote.create({ data: { userId, authorId, text: clean } });
  return { note };
}

module.exports = { getStats, listUsers, getUserDetail, addNote };
