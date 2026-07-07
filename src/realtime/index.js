'use strict';

const { Server } = require('socket.io');
const { verifyToken } = require('../lib/token');
const { getAllowedOrigins } = require('../lib/corsOrigins');
const onlineDrivers = require('./onlineDrivers');
const push = require('../lib/push');
const onlineCouriers = require('./onlineCouriers');
const onlineBusinesses = require('./onlineBusinesses');
const rideService = require('../services/rideService');
const foodOrderService = require('../services/foodOrderService');
const driverProfileService = require('../services/driverProfileService');
const businessProfileService = require('../services/businessProfileService');

// Nombre de sala por viaje.
const rideRoom = (rideId) => `ride:${rideId}`;

// Nombre de sala por pedido de comida.
const orderRoom = (orderId) => `order:${orderId}`;

// Radio de busqueda inicial de conductores cercanos (km).
const NEARBY_RADIUS_KM = 5;

// Mapea un ride a un payload "publico" para emitir por socket.
function ridePayload(ride) {
  return {
    id: ride.id,
    status: ride.status,
    rideType: ride.rideType,
    origin: { lat: ride.originLat, lng: ride.originLng, label: ride.originLabel },
    dest: { lat: ride.destLat, lng: ride.destLng, label: ride.destLabel },
    distanceKm: ride.distanceKm,
    durationMin: ride.durationMin,
    fare: ride.fare,
    passenger: ride.passenger || null,
    driver: ride.driver || null,
    acceptedAt: ride.acceptedAt,
    completedAt: ride.completedAt,
    cancelReason: ride.cancelReason,
    createdAt: ride.createdAt,
  };
}

// Helper para callbacks ACK opcionales (3er argumento de un emit del cliente).
function ack(cb, data) {
  if (typeof cb === 'function') cb(data);
}

// Instancia de Socket.IO (se setea en initRealtime). La usa el scheduler de
// reservas para despachar viajes programados sin un socket de pasajero.
let ioInstance = null;

// Despacha un ride a los conductores en línea cercanos: los mete en la sala
// "incoming:<rideId>", les emite ride:incoming y les manda push (app cerrada).
// Devuelve la cantidad de conductores avisados. Compartido por ride:request
// (tiempo real) y el scheduler de reservas programadas.
function dispatchToDrivers(io, ride) {
  let targets = onlineDrivers.findNearby(
    { lat: ride.originLat, lng: ride.originLng },
    NEARBY_RADIUS_KM
  );
  if (targets.length === 0) targets = onlineDrivers.all();
  if (targets.length === 0) return 0;

  const payload = ridePayload(ride);
  const fareTxt = ride.fare ? ` · G ${Math.round(ride.fare).toLocaleString('es-PY')}` : '';
  targets.forEach((d) => {
    const ds = io.sockets.sockets.get(d.socketId);
    if (ds) {
      ds.join(`incoming:${ride.id}`);
      ds.emit('ride:incoming', payload);
    }
    push.sendToUser(d.driverId, {
      title: '¡Nuevo viaje! 🚗',
      body: `${payload.origin?.label || 'Viaje disponible'}${fareTxt}`,
      url: '/',
    });
  });
  return targets.length;
}

// Despacha una reserva programada: crea el Ride, avisa a los conductores y
// manda push al pasajero (que puede tener la app cerrada). Devuelve el ride.
async function dispatchScheduledRide(scheduled) {
  if (!ioInstance) return null;
  const ride = await rideService.createRide(scheduled.passengerId, {
    rideType: scheduled.rideType,
    origin: { lat: scheduled.originLat, lng: scheduled.originLng, label: scheduled.originLabel },
    dest: { lat: scheduled.destLat, lng: scheduled.destLng, label: scheduled.destLabel },
    distanceKm: scheduled.distanceKm,
    durationMin: scheduled.durationMin,
    fare: scheduled.fare,
  });
  const drivers = dispatchToDrivers(ioInstance, ride);
  // Avisar al pasajero (app cerrada) que su reserva está saliendo.
  push.sendToUser(scheduled.passengerId, {
    title: 'Tu viaje reservado está saliendo 🚗',
    body: `${scheduled.destLabel ? 'Hacia ' + scheduled.destLabel + '. ' : ''}Abrí Jahapy para seguir a tu conductor.`,
    url: '/',
  });
  return { ride, drivers };
}

// Valida un punto { lat, lng } con coordenadas en rango geografico.
function isLatLng(p) {
  return (
    p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

function initRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: getAllowedOrigins(), credentials: true },
  });
  ioInstance = io; // disponible para el scheduler de reservas

  // --- Autenticacion del handshake ---
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Falta el token de autenticacion'));
    }
    try {
      const payload = verifyToken(token); // { sub, role }
      socket.userId = payload.sub;
      socket.role = payload.role;
      return next();
    } catch (err) {
      return next(new Error('Token invalido o expirado'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket;
    console.log(`[socket] conectado userId=${userId} role=${role} sid=${socket.id}`);

    // ===================== CONDUCTOR =====================

    socket.on('driver:online', async (data = {}, cb) => {
      if (role !== 'DRIVER') return ack(cb, { ok: false, error: 'Solo conductores' });
      const { lat, lng } = data;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return ack(cb, { ok: false, error: 'lat/lng requeridos' });
      }

      // Gate server-side: el conductor debe estar APROBADO en la BD.
      try {
        const profile = await driverProfileService.getByUserId(userId);
        if (!profile || profile.status !== 'approved') {
          socket.emit('driver:not_verified', {
            status: profile ? profile.status : 'none',
            message: 'Tu cuenta de conductor no esta aprobada todavia',
          });
          return ack(cb, { ok: false, error: 'Conductor no verificado' });
        }
      } catch (err) {
        console.error('[socket] driver:online verify error', err.message);
        return ack(cb, { ok: false, error: 'No se pudo verificar el conductor' });
      }

      onlineDrivers.setOnline(userId, socket.id, lat, lng);
      console.log(`[socket] driver:online ${userId} (${lat},${lng})`);
      return ack(cb, { ok: true });
    });

    socket.on('driver:offline', (_data, cb) => {
      onlineDrivers.setOffline(userId);
      console.log(`[socket] driver:offline ${userId}`);
      return ack(cb, { ok: true });
    });

    socket.on('driver:location', async (data = {}) => {
      if (role !== 'DRIVER') return;
      const { lat, lng } = data;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      onlineDrivers.updateLocation(userId, lat, lng);

      // Si tiene un viaje activo, reenviar la ubicacion al pasajero.
      try {
        const ride = await rideService.getDriverActiveRide(userId);
        if (ride) {
          io.to(rideRoom(ride.id)).emit('ride:driver_location', {
            rideId: ride.id,
            lat,
            lng,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[socket] driver:location error', err.message);
      }
    });

    socket.on('ride:accept', async (data = {}, cb) => {
      if (role !== 'DRIVER') return ack(cb, { ok: false, error: 'Solo conductores' });
      const { rideId } = data;
      if (!rideId) return ack(cb, { ok: false, error: 'rideId requerido' });

      try {
        // Gate de comision: si debe demasiado, no puede aceptar hasta pagar.
        const profile = await driverProfileService.getByUserId(userId);
        if (!profile || profile.status !== 'approved') {
          socket.emit('driver:not_verified', {
            status: profile ? profile.status : 'none',
            message: 'Tu cuenta de conductor no esta aprobada todavia',
          });
          return ack(cb, { ok: false, error: 'Conductor no verificado' });
        }
        if (profile.commissionDue >= driverProfileService.COMMISSION_LIMIT) {
          socket.emit('ride:commission_limit', {
            commissionDue: profile.commissionDue,
            limit: driverProfileService.COMMISSION_LIMIT,
            message: 'Tenes comision pendiente. Pagala para seguir aceptando viajes.',
          });
          return ack(cb, { ok: false, error: 'Comision pendiente: pagala para continuar' });
        }

        const ride = await rideService.acceptRide(rideId, userId);
        if (!ride) {
          // Ya fue tomado o no existe.
          socket.emit('ride:unavailable', { rideId });
          return ack(cb, { ok: false, error: 'Viaje no disponible' });
        }

        // El conductor entra a la sala del viaje.
        socket.join(rideRoom(ride.id));

        // Notificar al pasajero con datos del conductor.
        io.to(rideRoom(ride.id)).emit('ride:accepted', ridePayload(ride));

        // Avisar a los OTROS conductores que la habian recibido.
        socket.to(`incoming:${ride.id}`).emit('ride:taken', { rideId: ride.id });

        console.log(`[socket] ride:accept ${rideId} por driver ${userId}`);
        return ack(cb, { ok: true, ride: ridePayload(ride) });
      } catch (err) {
        console.error('[socket] ride:accept error', err.message);
        return ack(cb, { ok: false, error: 'Error al aceptar el viaje' });
      }
    });

    socket.on('ride:status', async (data = {}, cb) => {
      if (role !== 'DRIVER') return ack(cb, { ok: false, error: 'Solo conductores' });
      const { rideId, status } = data;
      if (!rideId || !status) return ack(cb, { ok: false, error: 'rideId y status requeridos' });

      try {
        const result = await rideService.advanceStatus(rideId, userId, status);
        if (result.error) {
          return ack(cb, { ok: false, error: result.error });
        }
        io.to(rideRoom(rideId)).emit('ride:status', {
          rideId,
          status: result.ride.status,
          completedAt: result.ride.completedAt,
        });
        console.log(`[socket] ride:status ${rideId} -> ${result.ride.status}`);
        return ack(cb, { ok: true, status: result.ride.status });
      } catch (err) {
        console.error('[socket] ride:status error', err.message);
        return ack(cb, { ok: false, error: 'Error al actualizar el estado' });
      }
    });

    // ===================== PASAJERO =====================

    socket.on('ride:request', async (data = {}, cb) => {
      if (role !== 'PASSENGER') return ack(cb, { ok: false, error: 'Solo pasajeros' });
      const { origin, dest } = data;
      if (!isLatLng(origin) || !isLatLng(dest)) {
        return ack(cb, { ok: false, error: 'origin y dest con lat/lng validos requeridos' });
      }
      if (data.fare != null && (typeof data.fare !== 'number' || data.fare < 0)) {
        return ack(cb, { ok: false, error: 'fare invalido' });
      }
      if (data.rideType != null && typeof data.rideType !== 'string') {
        return ack(cb, { ok: false, error: 'rideType invalido' });
      }

      try {
        const ride = await rideService.createRide(userId, data);

        // El pasajero entra a la sala del viaje para recibir actualizaciones.
        socket.join(rideRoom(ride.id));

        // Despachar a conductores cercanos (lógica compartida con el scheduler).
        const drivers = dispatchToDrivers(io, ride);
        if (drivers === 0) socket.emit('ride:no_drivers', { rideId: ride.id });

        console.log(`[socket] ride:request ${ride.id} -> ${drivers} conductores`);
        return ack(cb, { ok: true, rideId: ride.id, drivers });
      } catch (err) {
        console.error('[socket] ride:request error', err.message);
        return ack(cb, { ok: false, error: 'Error al solicitar el viaje' });
      }
    });

    socket.on('ride:cancel', async (data = {}, cb) => {
      const { rideId, reason } = data;
      if (!rideId) return ack(cb, { ok: false, error: 'rideId requerido' });

      try {
        const result = await rideService.cancelRide(rideId, userId, reason);
        if (result.error) {
          return ack(cb, { ok: false, error: result.error });
        }
        io.to(rideRoom(rideId)).emit('ride:cancelled', {
          rideId,
          cancelledBy: userId,
          reason: result.ride.cancelReason,
        });
        console.log(`[socket] ride:cancel ${rideId} por ${userId}`);
        return ack(cb, { ok: true });
      } catch (err) {
        console.error('[socket] ride:cancel error', err.message);
        return ack(cb, { ok: false, error: 'Error al cancelar el viaje' });
      }
    });

    // Chat en tiempo real entre pasajero y conductor (dentro de la sala del
    // viaje). Relay simple con timestamp REAL del servidor. Ambos ya estan en
    // rideRoom(rideId) al aceptarse el viaje.
    socket.on('ride:chat', (data = {}, cb) => {
      const { rideId, text } = data;
      if (!rideId || typeof text !== 'string' || !text.trim()) {
        return ack(cb, { ok: false, error: 'rideId y text requeridos' });
      }
      const msg = {
        rideId,
        text: text.trim().slice(0, 500),
        from: userId,
        role,
        at: new Date().toISOString(),
      };
      io.to(rideRoom(rideId)).emit('ride:message', msg);
      return ack(cb, { ok: true });
    });

    // ========================================================
    // ============ DELIVERY: PEDIDOS DE COMIDA ===============
    // ========================================================

    // Helper: notifica al comercio conectado de un orderId dado.
    function emitToBusiness(businessId, event, payload) {
      const sid = onlineBusinesses.getSocketId(businessId);
      if (!sid) return false;
      io.to(sid).emit(event, payload);
      return true;
    }

    // ===================== CLIENTE =====================

    socket.on('order:place', async (data = {}, cb) => {
      if (role !== 'PASSENGER') return ack(cb, { ok: false, error: 'Solo clientes' });
      const { businessId, items, address } = data;
      if (
        typeof businessId !== 'string' ||
        !businessId.trim() ||
        !Array.isArray(items) ||
        items.length === 0 ||
        items.length > 100 ||
        typeof address !== 'string' ||
        !address.trim() ||
        address.length > 500
      ) {
        return ack(cb, { ok: false, error: 'businessId, items y address validos requeridos' });
      }
      // Cada item debe tener forma minima { name, qty }.
      const itemsOk = items.every(
        (it) => it && typeof it.name === 'string' && Number(it.qty) > 0
      );
      if (!itemsOk) {
        return ack(cb, { ok: false, error: 'Cada item necesita name y qty > 0' });
      }

      try {
        const order = await foodOrderService.createOrder(userId, data);
        const payload = foodOrderService.orderPayload(order);

        // El cliente entra a la sala del pedido para recibir actualizaciones.
        socket.join(orderRoom(order.id));

        // Enviar al comercio si esta conectado; si no, queda PLACED.
        const delivered = emitToBusiness(order.businessId, 'order:incoming', payload);

        console.log(
          `[socket] order:place ${order.id} -> business ${order.businessId} (online=${delivered})`
        );
        return ack(cb, { ok: true, orderId: order.id, businessOnline: delivered });
      } catch (err) {
        console.error('[socket] order:place error', err.message);
        return ack(cb, { ok: false, error: 'Error al crear el pedido' });
      }
    });

    // ===================== COMERCIO =====================

    socket.on('business:online', async (data = {}, cb) => {
      const { businessId } = data;
      if (!businessId || typeof businessId !== 'string') {
        return ack(cb, { ok: false, error: 'businessId requerido' });
      }

      // Gate server-side: el comercio debe existir, ser del usuario conectado
      // y estar APROBADO en la BD.
      try {
        const profile = await businessProfileService.getById(businessId);
        if (!profile || profile.ownerId !== userId) {
          socket.emit('business:not_verified', {
            status: 'none',
            message: 'No sos el dueno de este comercio',
          });
          return ack(cb, { ok: false, error: 'Comercio no autorizado' });
        }
        if (profile.status !== 'approved') {
          socket.emit('business:not_verified', {
            status: profile.status,
            message: 'Tu comercio no esta aprobado todavia',
          });
          return ack(cb, { ok: false, error: 'Comercio no verificado' });
        }
      } catch (err) {
        console.error('[socket] business:online verify error', err.message);
        return ack(cb, { ok: false, error: 'No se pudo verificar el comercio' });
      }

      onlineBusinesses.setOnline(businessId, socket.id);
      socket.businessId = businessId;
      console.log(`[socket] business:online ${businessId} sid=${socket.id}`);
      return ack(cb, { ok: true });
    });

    socket.on('order:confirm', async (data = {}, cb) => {
      const businessId = socket.businessId;
      if (!businessId) return ack(cb, { ok: false, error: 'Hace business:online primero' });
      const { orderId } = data;
      if (!orderId) return ack(cb, { ok: false, error: 'orderId requerido' });

      try {
        const result = await foodOrderService.confirmOrder(orderId, businessId);
        if (result.error) return ack(cb, { ok: false, error: result.error });
        const payload = foodOrderService.orderPayload(result.order);
        io.to(orderRoom(orderId)).emit('order:status', {
          orderId,
          status: payload.status,
          confirmedAt: payload.confirmedAt,
        });
        console.log(`[socket] order:confirm ${orderId} -> CONFIRMED`);
        return ack(cb, { ok: true, status: payload.status });
      } catch (err) {
        console.error('[socket] order:confirm error', err.message);
        return ack(cb, { ok: false, error: 'Error al confirmar el pedido' });
      }
    });

    // Avance de estado. El COMERCIO maneja PREPARING/READY; el REPARTIDOR
    // maneja PICKED_UP->DELIVERING->DELIVERED. Se decide por rol/contexto.
    socket.on('order:status', async (data = {}, cb) => {
      const { orderId, status } = data;
      if (!orderId || !status) {
        return ack(cb, { ok: false, error: 'orderId y status requeridos' });
      }

      try {
        let result;
        if (socket.businessId) {
          result = await foodOrderService.advanceByBusiness(orderId, socket.businessId, status);
        } else if (role === 'COURIER') {
          result = await foodOrderService.advanceByCourier(orderId, userId, status);
        } else {
          return ack(cb, { ok: false, error: 'No autorizado para cambiar estado' });
        }
        if (result.error) return ack(cb, { ok: false, error: result.error });

        const payload = foodOrderService.orderPayload(result.order);

        // Notificar a la sala del pedido (cliente y partes en sala).
        io.to(orderRoom(orderId)).emit('order:status', {
          orderId,
          status: payload.status,
          readyAt: payload.readyAt,
          deliveredAt: payload.deliveredAt,
        });

        // Al pasar a READY, avisar a los repartidores en linea.
        if (payload.status === 'READY') {
          const couriers = onlineCouriers.all();
          couriers.forEach((c) => {
            const cs = io.sockets.sockets.get(c.socketId);
            if (cs) {
              cs.join(`delivery_incoming:${orderId}`);
              cs.emit('delivery:available', payload);
            }
          });
          console.log(
            `[socket] order:status ${orderId} -> READY (avisados ${couriers.length} repartidores)`
          );
        } else {
          console.log(`[socket] order:status ${orderId} -> ${payload.status}`);
        }

        return ack(cb, { ok: true, status: payload.status });
      } catch (err) {
        console.error('[socket] order:status error', err.message);
        return ack(cb, { ok: false, error: 'Error al actualizar el estado' });
      }
    });

    // ===================== REPARTIDOR =====================

    socket.on('courier:online', (data = {}, cb) => {
      if (role !== 'COURIER') return ack(cb, { ok: false, error: 'Solo repartidores' });
      const { lat, lng } = data;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return ack(cb, { ok: false, error: 'lat/lng requeridos' });
      }
      onlineCouriers.setOnline(userId, socket.id, lat, lng);
      console.log(`[socket] courier:online ${userId} (${lat},${lng})`);
      return ack(cb, { ok: true });
    });

    socket.on('courier:offline', (_data, cb) => {
      onlineCouriers.setOffline(userId);
      console.log(`[socket] courier:offline ${userId}`);
      return ack(cb, { ok: true });
    });

    socket.on('courier:location', async (data = {}) => {
      if (role !== 'COURIER') return;
      const { lat, lng } = data;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      onlineCouriers.updateLocation(userId, lat, lng);

      // Si tiene una entrega activa, reenviar la ubicacion al cliente.
      try {
        const order = await foodOrderService.getCourierActiveOrder(userId);
        if (order) {
          io.to(orderRoom(order.id)).emit('order:courier_location', {
            orderId: order.id,
            lat,
            lng,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[socket] courier:location error', err.message);
      }
    });

    socket.on('delivery:accept', async (data = {}, cb) => {
      if (role !== 'COURIER') return ack(cb, { ok: false, error: 'Solo repartidores' });
      const { orderId } = data;
      if (!orderId) return ack(cb, { ok: false, error: 'orderId requerido' });

      try {
        const order = await foodOrderService.acceptDelivery(orderId, userId);
        if (!order) {
          socket.emit('delivery:unavailable', { orderId });
          return ack(cb, { ok: false, error: 'Pedido no disponible' });
        }

        // El repartidor entra a la sala del pedido.
        socket.join(orderRoom(order.id));
        const payload = foodOrderService.orderPayload(order);

        // Notificar al cliente con datos del repartidor + nuevo estado.
        io.to(orderRoom(order.id)).emit('delivery:assigned', payload);
        io.to(orderRoom(order.id)).emit('order:status', {
          orderId: order.id,
          status: payload.status,
        });

        // Avisar a los OTROS repartidores que ya fue tomado.
        socket.to(`delivery_incoming:${order.id}`).emit('delivery:taken', { orderId: order.id });

        console.log(`[socket] delivery:accept ${orderId} por courier ${userId}`);
        return ack(cb, { ok: true, order: payload });
      } catch (err) {
        console.error('[socket] delivery:accept error', err.message);
        return ack(cb, { ok: false, error: 'Error al aceptar la entrega' });
      }
    });

    // ===================== CANCELACION =====================

    socket.on('order:cancel', async (data = {}, cb) => {
      const { orderId, reason } = data;
      if (!orderId) return ack(cb, { ok: false, error: 'orderId requerido' });

      try {
        const result = await foodOrderService.cancelOrder(
          orderId,
          userId,
          role,
          socket.businessId,
          reason
        );
        if (result.error) return ack(cb, { ok: false, error: result.error });

        const payload = foodOrderService.orderPayload(result.order);

        // Notificar a la sala del pedido (cliente + repartidor si hay).
        io.to(orderRoom(orderId)).emit('order:cancelled', {
          orderId,
          cancelledBy: userId,
          reason: payload.cancelReason,
        });
        // Tambien al comercio (puede no estar en la sala).
        emitToBusiness(payload.businessId, 'order:cancelled', {
          orderId,
          cancelledBy: userId,
          reason: payload.cancelReason,
        });

        console.log(`[socket] order:cancel ${orderId} por ${userId}`);
        return ack(cb, { ok: true });
      } catch (err) {
        console.error('[socket] order:cancel error', err.message);
        return ack(cb, { ok: false, error: 'Error al cancelar el pedido' });
      }
    });

    // ===================== DESCONEXION =====================

    socket.on('disconnect', async () => {
      console.log(`[socket] desconectado userId=${userId} sid=${socket.id}`);
      if (role === 'DRIVER') {
        const removed = onlineDrivers.removeBySocketId(socket.id);
        if (removed) {
          // Si tenia un viaje activo, avisar al pasajero.
          try {
            const ride = await rideService.getDriverActiveRide(userId);
            if (ride) {
              io.to(rideRoom(ride.id)).emit('ride:driver_disconnected', {
                rideId: ride.id,
                driverId: userId,
              });
            }
          } catch (err) {
            console.error('[socket] disconnect error', err.message);
          }
        }
      }

      // Repartidor: sacar de online y avisar al cliente si tenia entrega activa.
      if (role === 'COURIER') {
        const removed = onlineCouriers.removeBySocketId(socket.id);
        if (removed) {
          try {
            const order = await foodOrderService.getCourierActiveOrder(userId);
            if (order) {
              io.to(orderRoom(order.id)).emit('order:courier_disconnected', {
                orderId: order.id,
                courierId: userId,
              });
            }
          } catch (err) {
            console.error('[socket] disconnect courier error', err.message);
          }
        }
      }

      // Comercio: sacar del Map; avisar a clientes con pedidos activos.
      const removedBiz = onlineBusinesses.removeBySocketId(socket.id);
      if (removedBiz) {
        console.log(`[socket] business offline ${removedBiz}`);
      }
    });
  });

  return io;
}

module.exports = { initRealtime, dispatchScheduledRide };
