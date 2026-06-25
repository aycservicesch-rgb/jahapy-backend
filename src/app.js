'use strict';

const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const rideRoutes = require('./routes/rides');
const orderRoutes = require('./routes/orders');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { getAllowedOrigins } = require('./lib/corsOrigins');

const app = express();

// CORS configurable por env (CORS_ORIGIN, lista separada por comas).
app.use(cors({ origin: getAllowedOrigins(), credentials: true }));
app.use(express.json());

// Chequeo de salud
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api', userRoutes);

// 404 + manejo de errores
app.use(notFound);
app.use(errorHandler);

module.exports = app;
