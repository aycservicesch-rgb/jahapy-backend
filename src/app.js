'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const rideRoutes = require('./routes/rides');
const orderRoutes = require('./routes/orders');
const driverRoutes = require('./routes/driver');
const businessRoutes = require('./routes/business');
const adminRoutes = require('./routes/admin');
const pushRoutes = require('./routes/push');
const paymentRoutes = require('./routes/payments');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { generalLimiter, authLimiter } = require('./middleware/rateLimit');
const { getAllowedOrigins } = require('./lib/corsOrigins');

const app = express();

// Detras del proxy de Render: necesario para que express-rate-limit lea la IP real.
app.set('trust proxy', 1);

// Headers de seguridad (CSP, HSTS, etc.).
app.use(helmet());

// CORS configurable por env (CORS_ORIGIN, lista separada por comas). NO usa '*'.
app.use(cors({ origin: getAllowedOrigins(), credentials: true }));

// Limite de tamano del body para evitar payloads abusivos.
app.use(express.json({ limit: '1mb' }));

// Rate limiting general para toda la API.
app.use(generalLimiter);

// Chequeo de salud
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Rutas de la API
// /api/auth con un limiter MAS estricto (anti fuerza bruta).
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api', userRoutes);

// 404 + manejo de errores
app.use(notFound);
app.use(errorHandler);

module.exports = app;
