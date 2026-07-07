'use strict';

require('dotenv').config();

const http = require('http');
const app = require('./app');
const { initRealtime, dispatchScheduledRide } = require('./realtime');
const scheduledRideService = require('./services/scheduledRideService');

const PORT = process.env.PORT || 4000;
// Render (y otros PaaS) requieren escuchar en 0.0.0.0.
const HOST = process.env.HOST || '0.0.0.0';

// Servidor HTTP compartido por Express y Socket.IO.
const httpServer = http.createServer(app);

// Tiempo real (viajes de transporte).
initRealtime(httpServer);

httpServer.listen(PORT, HOST, () => {
  console.log(`[jahapy-backend] escuchando en ${HOST}:${PORT}`);
  console.log('[jahapy-backend] Socket.IO activo (viajes + delivery en tiempo real)');
});

// --- Scheduler de RESERVAS programadas ---
// Cada 60s busca las reservas que llegaron a su hora y las despacha (crea el
// Ride, avisa a conductores cercanos y push al pasajero). El backend está
// siempre encendido (plan Starter), así que este intervalo corre 24/7.
const SCHEDULER_MS = 60 * 1000;
let schedulerRunning = false;
setInterval(async () => {
  if (schedulerRunning) return; // evitar solaparse si una corrida tarda
  schedulerRunning = true;
  try {
    const due = await scheduledRideService.findDue();
    for (const r of due) {
      try {
        const result = await dispatchScheduledRide(r);
        await scheduledRideService.markDispatched(r.id, result?.ride?.id || null);
        console.log(`[scheduler] reserva ${r.id} despachada -> ride ${result?.ride?.id} (${result?.drivers || 0} conductores)`);
      } catch (err) {
        console.error(`[scheduler] error despachando ${r.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[scheduler] error:', err.message);
  } finally {
    schedulerRunning = false;
  }
}, SCHEDULER_MS);
