'use strict';

// Prueba end-to-end de PEDIDOS DE COMIDA (delivery) EN TIEMPO REAL simulando
// TRES dispositivos: CLIENTE -> COMERCIO (restaurante) -> REPARTIDOR.
//
// Requiere el server corriendo (npm start / npm run dev) en el puerto 4000.
// Ejecutar: node scripts/test-food-realtime.js

const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:4000';

// El comercio se identifica por un businessId (String libre, sin tabla todavia).
const BUSINESS_ID = `resto_${Date.now()}`;
// Repartidor cerca del comercio (Asuncion).
const COURIER_LOC = { lat: -25.2840, lng: -57.6300 };

const log = (who, msg, data) =>
  console.log(`  [${who}] ${msg}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function registerUser(role, name) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `${role.toLowerCase()}_${stamp}@jahapy.test`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: name,
      email,
      password: 'secret123',
      phone: `+59598${String(stamp).slice(-7)}`,
      role,
      city: 'Asuncion',
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`register ${role} fallo: ${JSON.stringify(body)}`);
  return { token: body.token, user: body.user };
}

function connect(token) {
  const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => reject(new Error('connect_error: ' + e.message)));
  });
}

async function main() {
  console.log('\n=== PRUEBA DE DELIVERY EN TIEMPO REAL (3 dispositivos) ===\n');

  // 1) REST: registrar cliente, dueno de comercio y repartidor.
  console.log('1) Registrando usuarios (REST)...');
  const customer = await registerUser('PASSENGER', 'Ana Cliente');
  const business = await registerUser('PASSENGER', 'Pizzeria Don Vito'); // dueno del comercio
  const courier = await registerUser('COURIER', 'Pedro Repartidor');
  log('REST', 'cliente creado', { id: customer.user.id, name: customer.user.fullName });
  log('REST', 'comercio (dueno) creado', { id: business.user.id, businessId: BUSINESS_ID });
  log('REST', 'repartidor creado', { id: courier.user.id, name: courier.user.fullName });

  // 2) Conectar los 3 sockets.
  console.log('\n2) Conectando sockets...');
  const cSock = await connect(customer.token); // CLIENTE
  const bSock = await connect(business.token); // COMERCIO
  const rSock = await connect(courier.token); // REPARTIDOR
  log('CLIENTE', 'socket conectado', { sid: cSock.id });
  log('COMERCIO', 'socket conectado', { sid: bSock.id });
  log('REPARTIDOR', 'socket conectado', { sid: rSock.id });

  // Listeners del CLIENTE (capturamos cada evento que recibe).
  const customerEvents = [];
  ['order:status', 'delivery:assigned', 'order:courier_location', 'order:cancelled'].forEach((ev) =>
    cSock.on(ev, (d) => {
      customerEvents.push(ev);
      log('CLIENTE recibe', ev, d);
    })
  );

  // 2b) Comercio en linea + repartidor en linea.
  console.log('\n2b) Comercio -> business:online ; Repartidor -> courier:online');
  const bOnline = await emitAck(bSock, 'business:online', { businessId: BUSINESS_ID });
  log('COMERCIO', 'business:online ack', bOnline);
  const rOnline = await emitAck(rSock, 'courier:online', COURIER_LOC);
  log('REPARTIDOR', 'courier:online ack', rOnline);

  // 3) Cliente hace order:place -> el COMERCIO debe recibir order:incoming.
  console.log('\n3) Cliente -> order:place');
  const incomingP = waitFor(bSock, 'order:incoming');
  const placeRes = await emitAck(cSock, 'order:place', {
    businessId: BUSINESS_ID,
    items: [
      { name: 'Pizza Margarita', qty: 1, price: 45000 },
      { name: 'Coca 1.5L', qty: 1, price: 12000 },
    ],
    subtotal: 57000,
    deliveryFee: 10000,
    total: 67000,
    address: 'Av. Espana 123, Asuncion',
    notes: 'Tocar timbre 2 veces',
  });
  log('CLIENTE', 'order:place ack', placeRes);
  const orderId = placeRes.orderId;
  const incoming = await incomingP;
  log('COMERCIO recibe', 'order:incoming', {
    id: incoming.id,
    total: incoming.total,
    items: incoming.items.length,
    address: incoming.address,
  });

  // 4) Comercio: confirm -> PREPARING -> READY.
  console.log('\n4) Comercio -> order:confirm, PREPARING, READY');
  let statusP = waitFor(cSock, 'order:status');
  const confRes = await emitAck(bSock, 'order:confirm', { orderId });
  log('COMERCIO', 'order:confirm ack', confRes);
  let recv = await statusP;
  log('CLIENTE recibe', 'order:status', { status: recv.status });

  statusP = waitFor(cSock, 'order:status');
  const prepRes = await emitAck(bSock, 'order:status', { orderId, status: 'PREPARING' });
  log('COMERCIO', 'order:status -> PREPARING ack', prepRes);
  recv = await statusP;
  log('CLIENTE recibe', 'order:status', { status: recv.status });

  // READY -> cliente recibe status Y repartidor recibe delivery:available.
  const availP = waitFor(rSock, 'delivery:available');
  statusP = waitFor(cSock, 'order:status');
  const readyRes = await emitAck(bSock, 'order:status', { orderId, status: 'READY' });
  log('COMERCIO', 'order:status -> READY ack', readyRes);
  recv = await statusP;
  log('CLIENTE recibe', 'order:status', { status: recv.status, readyAt: recv.readyAt || null });
  const avail = await availP;
  log('REPARTIDOR recibe', 'delivery:available', { id: avail.id, total: avail.total });

  // 5) Repartidor acepta -> cliente recibe delivery:assigned.
  console.log('\n5) Repartidor -> delivery:accept');
  const assignedP = waitFor(cSock, 'delivery:assigned');
  const accRes = await emitAck(rSock, 'delivery:accept', { orderId });
  log('REPARTIDOR', 'delivery:accept ack', { ok: accRes.ok, status: accRes.order && accRes.order.status });
  const assigned = await assignedP;
  log('CLIENTE recibe', 'delivery:assigned', {
    status: assigned.status,
    courier: assigned.courier && assigned.courier.fullName,
  });

  // 6) Repartidor manda ubicacion -> cliente recibe order:courier_location.
  console.log('\n6) Repartidor -> courier:location');
  const locP = waitFor(cSock, 'order:courier_location');
  rSock.emit('courier:location', { lat: -25.2845, lng: -57.6320 });
  const loc = await locP;
  log('CLIENTE recibe', 'order:courier_location', { lat: loc.lat, lng: loc.lng });

  // 7) Repartidor avanza DELIVERING -> DELIVERED.
  console.log('\n7) Repartidor avanza estados...');
  const flow = ['DELIVERING', 'DELIVERED'];
  for (const status of flow) {
    statusP = waitFor(cSock, 'order:status');
    const r = await emitAck(rSock, 'order:status', { orderId, status });
    log('REPARTIDOR', `order:status -> ${status}`, { ok: r.ok });
    recv = await statusP;
    log('CLIENTE recibe', 'order:status', {
      status: recv.status,
      deliveredAt: recv.deliveredAt || null,
    });
  }

  // 8) REST: GET /api/orders/mine para cliente y repartidor.
  console.log('\n8) GET /api/orders/mine (REST)...');
  const mineC = await (await fetch(`${BASE}/api/orders/mine`, {
    headers: { Authorization: `Bearer ${customer.token}` },
  })).json();
  const mineR = await (await fetch(`${BASE}/api/orders/mine`, {
    headers: { Authorization: `Bearer ${courier.token}` },
  })).json();
  log('CLIENTE', 'orders/mine', {
    total: mineC.orders.length,
    ultimo: { id: mineC.orders[0].id, status: mineC.orders[0].status, total: mineC.orders[0].total },
  });
  log('REPARTIDOR', 'orders/mine', {
    total: mineR.orders.length,
    ultimo: {
      id: mineR.orders[0].id,
      status: mineR.orders[0].status,
      customer: mineR.orders[0].customer.fullName,
    },
  });

  // Resumen.
  console.log('\n=== RESUMEN ===');
  console.log('Eventos recibidos por el CLIENTE:', customerEvents.join(', '));
  const okAll =
    customerEvents.includes('delivery:assigned') &&
    customerEvents.includes('order:courier_location') &&
    mineC.orders[0].status === 'DELIVERED' &&
    mineC.orders[0].deliveredAt &&
    mineR.orders.length === 1;
  console.log(
    okAll
      ? 'RESULTADO: OK - delivery en tiempo real end-to-end funcionando.'
      : 'RESULTADO: revisar, falto algun evento.'
  );

  await wait(200);
  cSock.close();
  bSock.close();
  rSock.close();
  process.exit(okAll ? 0 : 1);
}

main().catch((err) => {
  console.error('\nERROR en test-food-realtime:', err.message);
  process.exit(1);
});
