'use strict';

// Estado en memoria de los conductores conectados y EN LINEA.
// Para el MVP no se persiste: si el server se reinicia, se vacia.
// Map<driverId, { driverId, socketId, lat, lng, updatedAt }>

const { haversineKm } = require('../lib/geo');

const drivers = new Map();

function setOnline(driverId, socketId, lat, lng) {
  drivers.set(driverId, {
    driverId,
    socketId,
    lat,
    lng,
    updatedAt: new Date().toISOString(),
  });
  return drivers.get(driverId);
}

function updateLocation(driverId, lat, lng) {
  const d = drivers.get(driverId);
  if (!d) return null;
  d.lat = lat;
  d.lng = lng;
  d.updatedAt = new Date().toISOString();
  return d;
}

function setOffline(driverId) {
  return drivers.delete(driverId);
}

// Saca al conductor por socketId (util en disconnect). Devuelve el driverId removido o null.
function removeBySocketId(socketId) {
  for (const [driverId, d] of drivers.entries()) {
    if (d.socketId === socketId) {
      drivers.delete(driverId);
      return driverId;
    }
  }
  return null;
}

function get(driverId) {
  return drivers.get(driverId) || null;
}

function all() {
  return [...drivers.values()];
}

// Conductores dentro de `radiusKm` de un punto {lat,lng}, ordenados por cercania.
function findNearby(point, radiusKm = 5) {
  const result = [];
  for (const d of drivers.values()) {
    const distanceKm = haversineKm(point, { lat: d.lat, lng: d.lng });
    if (distanceKm <= radiusKm) {
      result.push({ ...d, distanceKm });
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
