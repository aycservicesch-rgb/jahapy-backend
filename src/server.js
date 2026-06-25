'use strict';

require('dotenv').config();

const http = require('http');
const app = require('./app');
const { initRealtime } = require('./realtime');

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
