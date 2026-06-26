'use strict';

const prisma = require('../lib/prisma');
const driverProfileService = require('./driverProfileService');

const RIDE_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'ARRIVING',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
];

// Transiciones permitidas que puede aplicar el CONDUCTOR via `ride:status`.
const DRIVER_TRANSITIONS = {
  ACCEPTED: ['ARRIVING'],
  ARRIVING: ['ARRIVED'],
  ARRIVED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
};

// Estados que se consideran "activos" (un viaje en curso).
const ACTIVE_STATUSES = ['REQUESTED', 'ACCEPTED', 'ARRIVING', 'ARRIVED', 'IN_PROGRESS'];

const RIDE_INCLUDE = {
  passenger: { select: { id: true, fullName: true, phone: true, rating: true } },
  driver: { select: { id: true, fullName: true, phone: true, rating: true } },
};

async function createRide(passengerId, data) {
  return prisma.ride.create({
    data: {
      passengerId,
      status: 'REQUESTED',
      rideType: data.rideType || 'standard',
      originLat: data.origin.lat,
      originLng: data.origin.lng,
      originLabel: data.origin.label || null,
      destLat: data.dest.lat,
      destLng: data.dest.lng,
      destLabel: data.dest.label || null,
      distanceKm: data.distanceKm ?? null,
      durationMin: data.durationMin ?? null,
      fare: data.fare ?? null,
      paymentMethod: data.paymentMethod === 'card' ? 'card' : 'cash',
    },
    include: RIDE_INCLUDE,
  });
}

// Asigna el viaje a un conductor solo si sigue en REQUESTED (evita doble asignacion).
// Devuelve el ride actualizado o null si ya fue tomado / no existe.
async function acceptRide(rideId, driverId) {
  const result = await prisma.ride.updateMany({
    where: { id: rideId, status: 'REQUESTED', driverId: null },
    data: { status: 'ACCEPTED', driverId, acceptedAt: new Date() },
  });
  if (result.count === 0) return null;
  return prisma.ride.findUnique({ where: { id: rideId }, include: RIDE_INCLUDE });
}

// Avance de estado por parte del conductor; valida transicion.
async function advanceStatus(rideId, driverId, nextStatus) {
  if (!RIDE_STATUSES.includes(nextStatus)) {
    return { error: 'Estado invalido' };
  }
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) return { error: 'Viaje no encontrado' };
  if (ride.driverId !== driverId) return { error: 'No sos el conductor de este viaje' };

  const allowed = DRIVER_TRANSITIONS[ride.status] || [];
  if (!allowed.includes(nextStatus)) {
    return { error: `Transicion no permitida: ${ride.status} -> ${nextStatus}` };
  }

  const data = { status: nextStatus };
  if (nextStatus === 'COMPLETED') data.completedAt = new Date();

  const updated = await prisma.ride.update({
    where: { id: rideId },
    data,
    include: RIDE_INCLUDE,
  });

  // Comision server-side: al COMPLETAR un viaje en EFECTIVO, se acumula al
  // conductor el 20% de la tarifa (redondeo a centena). Best-effort: si falla,
  // no rompe la finalizacion del viaje.
  if (nextStatus === 'COMPLETED' && updated.paymentMethod === 'cash' && updated.fare) {
    try {
      const commission = driverProfileService.calcCommission(updated.fare);
      if (commission > 0) {
        await driverProfileService.addCommission(driverId, commission);
      }
    } catch (err) {
      console.error('[rideService] addCommission error', err.message);
    }
  }

  return { ride: updated };
}

// Cancelacion por pasajero o conductor (solo si esta activo y no completado).
async function cancelRide(rideId, userId, reason) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) return { error: 'Viaje no encontrado' };
  if (ride.passengerId !== userId && ride.driverId !== userId) {
    return { error: 'No sos parte de este viaje' };
  }
  if (['COMPLETED', 'CANCELLED'].includes(ride.status)) {
    return { error: 'El viaje ya finalizo' };
  }
  const updated = await prisma.ride.update({
    where: { id: rideId },
    data: { status: 'CANCELLED', cancelReason: reason || null },
    include: RIDE_INCLUDE,
  });
  return { ride: updated, cancelledBy: userId };
}

async function getRideById(rideId) {
  return prisma.ride.findUnique({ where: { id: rideId }, include: RIDE_INCLUDE });
}

async function listMyRides(userId) {
  return prisma.ride.findMany({
    where: { OR: [{ passengerId: userId }, { driverId: userId }] },
    orderBy: { createdAt: 'desc' },
    include: RIDE_INCLUDE,
  });
}

async function getActiveRide(userId) {
  return prisma.ride.findFirst({
    where: {
      OR: [{ passengerId: userId }, { driverId: userId }],
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
    include: RIDE_INCLUDE,
  });
}

// El viaje activo de un conductor (para reenviar su ubicacion al pasajero).
async function getDriverActiveRide(driverId) {
  return prisma.ride.findFirst({
    where: {
      driverId,
      status: { in: ['ACCEPTED', 'ARRIVING', 'ARRIVED', 'IN_PROGRESS'] },
    },
    orderBy: { createdAt: 'desc' },
    include: RIDE_INCLUDE,
  });
}

module.exports = {
  RIDE_STATUSES,
  ACTIVE_STATUSES,
  createRide,
  acceptRide,
  advanceStatus,
  cancelRide,
  getRideById,
  listMyRides,
  getActiveRide,
  getDriverActiveRide,
};
