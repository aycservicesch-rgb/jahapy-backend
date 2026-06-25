'use strict';

// Estado en memoria de los COMERCIOS (restaurantes) conectados.
// Mapea businessId -> socketId para enviarles los pedidos entrantes.
// No se persiste: si el server se reinicia, se vacia.
// Map<businessId, socketId>

const businesses = new Map();

function setOnline(businessId, socketId) {
  businesses.set(businessId, socketId);
  return socketId;
}

function getSocketId(businessId) {
  return businesses.get(businessId) || null;
}

// Saca al comercio por socketId (util en disconnect). Devuelve el businessId o null.
function removeBySocketId(socketId) {
  for (const [businessId, sid] of businesses.entries()) {
    if (sid === socketId) {
      businesses.delete(businessId);
      return businessId;
    }
  }
  return null;
}

function setOffline(businessId) {
  return businesses.delete(businessId);
}

function all() {
  return [...businesses.keys()];
}

module.exports = {
  setOnline,
  getSocketId,
  removeBySocketId,
  setOffline,
  all,
};
