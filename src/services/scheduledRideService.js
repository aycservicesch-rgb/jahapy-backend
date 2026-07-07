'use strict';

const prisma = require('../lib/prisma');

// Anticipación mínima/máxima de una reserva.
const MIN_LEAD_MS = 10 * 60 * 1000;        // al menos 10 min en el futuro
const MAX_LEAD_MS = 30 * 24 * 3600 * 1000; // hasta 30 días

function isLatLng(p) {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number'
    && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

// Crea una reserva de viaje para un momento futuro.
async function create(passengerId, data = {}) {
  const { origin, dest, scheduledFor } = data;
  if (!isLatLng(origin) || !isLatLng(dest)) return { error: 'origen y destino requeridos' };
  const when = new Date(scheduledFor);
  if (isNaN(when.getTime())) return { error: 'Fecha/hora inválida' };
  const delta = when.getTime() - Date.now();
  if (delta < MIN_LEAD_MS) return { error: 'Programá el viaje con al menos 10 minutos de anticipación' };
  if (delta > MAX_LEAD_MS) return { error: 'Solo se puede programar hasta 30 días' };

  const ride = await prisma.scheduledRide.create({
    data: {
      passengerId,
      rideType: typeof data.rideType === 'string' ? data.rideType : 'standard',
      originLat: origin.lat, originLng: origin.lng, originLabel: origin.label || null,
      destLat: dest.lat, destLng: dest.lng, destLabel: dest.label || null,
      distanceKm: data.distanceKm ?? null,
      durationMin: data.durationMin ?? null,
      fare: typeof data.fare === 'number' ? Math.round(data.fare) : null,
      scheduledFor: when,
      status: 'scheduled',
    },
  });
  return { ride };
}

// Reservas futuras del pasajero (las que todavía no salieron).
async function listUpcoming(passengerId) {
  return prisma.scheduledRide.findMany({
    where: { passengerId, status: 'scheduled' },
    orderBy: { scheduledFor: 'asc' },
  });
}

// Cancela una reserva (solo del dueño y si sigue 'scheduled').
async function cancel(id, passengerId) {
  const r = await prisma.scheduledRide.findUnique({ where: { id } });
  if (!r || r.passengerId !== passengerId) return { error: 'Reserva no encontrada' };
  if (r.status !== 'scheduled') return { error: 'La reserva ya no se puede cancelar' };
  const updated = await prisma.scheduledRide.update({
    where: { id },
    data: { status: 'cancelled' },
  });
  return { ride: updated };
}

// Reservas que llegaron a su hora y hay que despachar.
async function findDue() {
  return prisma.scheduledRide.findMany({
    where: { status: 'scheduled', scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
    take: 50,
  });
}

// Marca una reserva como despachada, asociándole el Ride creado.
async function markDispatched(id, rideId) {
  return prisma.scheduledRide.update({
    where: { id },
    data: { status: 'dispatched', rideId, dispatchedAt: new Date() },
  });
}

module.exports = { create, listUpcoming, cancel, findDue, markDispatched };
