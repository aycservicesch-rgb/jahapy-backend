'use strict';

// Estado en memoria de los REPARTIDORES (couriers) conectados y EN LINEA.
// Analogo a onlineDrivers, pero para delivery de comida.
// No se persiste: si el server se reinicia, se vacia.
// Map<courierId, { courierId, socketId, lat, lng, updatedAt }>

const { haversineKm } = require('../lib/geo');

const couriers = new Map();

function setOnline(courierId, socketId, lat, lng) {
  couriers.set(courierId, {
    courierId,
    socketId,
    lat,
    lng,
    updatedAt: new Date().toISOString(),
  });
  return couriers.get(courierId);
}

function updateLocation(courierId, lat, lng) {
  const c = couriers.get(courierId);
  if (!c) return null;
  c.lat = lat;
  c.lng = lng;
  c.updatedAt = new Date().toISOString();
  return c;
}

function setOffline(courierId) {
  return couriers.delete(courierId);
}

// Saca al repartidor por socketId (util en disconnect). Devuelve el courierId o null.
function removeBySocketId(socketId) {
  for (const [courierId, c] of couriers.entries()) {
    if (c.socketId === socketId) {
      couriers.delete(courierId);
      return courierId;
    }
  }
  return null;
}

function get(courierId) {
  return couriers.get(courierId) || null;
}

function all() {
  return [...couriers.values()];
}

// Repartidores dentro de `radiusKm` de un punto {lat,lng}, ordenados por cercania.
function findNearby(point, radiusKm = 5) {
  const result = [];
  for (const c of couriers.values()) {
    const distanceKm = haversineKm(point, { lat: c.lat, lng: c.lng });
    if (distanceKm <= radiusKm) {
      result.push({ ...c, distanceKm });
    }
  }
  result.sort((a, b) => a.distanceKm - b.distanceKm);
  return result;
}

module.exports = {
  setOnline,
  updateLocation,
  setOffline,
  removeBySocketId,
  get,
  all,
  findNearby,
};
