'use strict';

// Prueba end-to-end de VIAJES EN TIEMPO REAL simulando DOS dispositivos:
// un PASAJERO y un CONDUCTOR, conectados por separado via Socket.IO.
//
// Requiere el server corriendo (npm start / npm run dev) en el puerto 4000.
// Ejecutar: node scripts/test-realtime.js

const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:4000';

// Coordenadas en Asuncion, Paraguay.
const ASUNCION_CENTRO = { lat: -25.2867, lng: -57.3333 };
const ORIGEN = { lat: -25.2820, lng: -57.6359, label: 'Microcentro, Asuncion' };
const DESTINO = { lat: -25.3010, lng: -57.5650, label: 'Shopping del Sol, Asuncion' };
// Conductor cerca del origen.
const DRIVER_LOC = { lat: -25.2840, lng: -57.6300 };

const log = (who, msg, data) =>
  console.log(`  [${who}] ${msg}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Espera un evento de socket con timeout.
function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

// Emit con ACK (callback) y promesa.
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
  console.log('\n=== PRUEBA DE VIAJES EN TIEMPO REAL (2 dispositivos) ===\n');

  // 1) REST: registrar pasajero y conductor.
  console.log('1) Registrando usuarios (REST)...');
  const passenger = await registerUser('PASSENGER', 'Ana Pasajera');
  const driver = await registerUser('DRIVER', 'Carlos Conductor');
  log('REST', 'pasajero creado', { id: passenger.user.id, name: passenger.user.fullName });
  log('REST', 'conductor creado', { id: driver.user.id, name: driver.user.fullName });

  // 2) Conectar ambos sockets.
  console.log('\n2) Conectando sockets...');
  const pSock = await connect(passenger.token);
  const dSock = await connect(driver.token);
  log('PASAJERO', 'socket conectado', { sid: pSock.id });
  log('CONDUCTOR', 'socket conectado', { sid: dSock.id });

  // Listeners del PASAJERO (capturamos cada evento que recibe).
  const passengerEvents = [];
  ['ride:accepted', 'ride:driver_location', 'ride:status', 'ride:no_drivers', 'ride:cancelled'].forEach(
    (ev) =>
      pSock.on(ev, (d) => {
        passengerEvents.push(ev);
        log('PASAJERO recibe', ev, d);
      })
  );

  // 3) Conductor se pone EN LINEA en Asuncion.
  console.log('\n3) Conductor -> driver:online');
  const onlineRes = await emitAck(dSock, 'driver:online', DRIVER_LOC);
  log('CONDUCTOR', 'driver:online ack', onlineRes);

  // Preparar la espera del ride:incoming en el conductor ANTES de pedir.
  const incomingP = waitFor(dSock, 'ride:incoming');

  // 4) Pasajero solicita un viaje.
  console.log('\n4) Pasajero -> ride:request');
  const reqRes = await emitAck(pSock, 'ride:request', {
    rideType: 'standard',
    origin: ORIGEN,
    dest: DESTINO,
    distanceKm: 8.4,
    durationMin: 18,
    fare: 35000,
  });
  log('PASAJERO', 'ride:request ack', reqRes);
  const rideId = reqRes.rideId;

  // 5) Confirmar que el conductor recibe ride:incoming.
  console.log('\n5) Esperando ride:incoming en el CONDUCTOR...');
  const incoming = await incomingP;
  log('CONDUCTOR recibe', 'ride:incoming', { id: incoming.id, fare: incoming.fare, origin: incoming.origin.label });

  // 6) Conductor acepta -> pasajero recibe ride:accepted.
  console.log('\n6) Conductor -> ride:accept');
  const acceptedP = waitFor(pSock, 'ride:accepted');
  const accRes = await emitAck(dSock, 'ride:accept', { rideId });
  log('CONDUCTOR', 'ride:accept ack', { ok: accRes.ok });
  const accepted = await acceptedP;
  log('PASAJERO recibe', 'ride:accepted', {
    status: accepted.status,
    driver: accepted.driver,
  });

  // 7) Conductor manda ubicacion -> pasajero recibe ride:driver_location.
  console.log('\n7) Conductor -> driver:location');
  const locP = waitFor(pSock, 'ride:driver_location');
  dSock.emit('driver:location', { lat: -25.2835, lng: -57.6320 });
  const loc = await locP;
  log('PASAJERO recibe', 'ride:driver_location', { lat: loc.lat, lng: loc.lng });

  // 8) Conductor avanza estados hasta COMPLETED.
  console.log('\n8) Conductor avanza estados...');
  const flow = ['ARRIVING', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];
  for (const status of flow) {
    const statusP = waitFor(pSock, 'ride:status');
    const r = await emitAck(dSock, 'ride:status', { rideId, status });
    log('CONDUCTOR', `ride:status -> ${status}`, { ok: r.ok });
    const recv = await statusP;
    log('PASAJERO recibe', 'ride:status', { status: recv.status, completedAt: recv.completedAt || null });
  }

  // 9) REST: GET /api/rides/mine para ambos.
  console.log('\n9) GET /api/rides/mine (REST)...');
  const mineP = await (await fetch(`${BASE}/api/rides/mine`, {
    headers: { Authorization: `Bearer ${passenger.token}` },
  })).json();
  const mineD = await (await fetch(`${BASE}/api/rides/mine`, {
    headers: { Authorization: `Bearer ${driver.token}` },
  })).json();
  log('PASAJERO', 'rides/mine', {
    total: mineP.rides.length,
    ultimo: { id: mineP.rides[0].id, status: mineP.rides[0].status, fare: mineP.rides[0].fare },
  });
  log('CONDUCTOR', 'rides/mine', {
    total: mineD.rides.length,
    ultimo: { id: mineD.rides[0].id, status: mineD.rides[0].status, driver: mineD.rides[0].driver.fullName },
  });

  // Resumen.
  console.log('\n=== RESUMEN ===');
  console.log('Eventos recibidos por el PASAJERO:', passengerEvents.join(', '));
  const okAll =
    passengerEvents.includes('ride:accepted') &&
    passengerEvents.includes('ride:driver_location') &&
    mineP.rides[0].status === 'COMPLETED' &&
    mineD.rides.length === 1;
  console.log(okAll ? 'RESULTADO: OK - tiempo real end-to-end funcionando.' : 'RESULTADO: revisar, falto algun evento.');

  await wait(200);
  pSock.close();
  dSock.close();
  process.exit(okAll ? 0 : 1);
}

main().catch((err) => {
  console.error('\nERROR en test-realtime:', err.message);
  process.exit(1);
});
