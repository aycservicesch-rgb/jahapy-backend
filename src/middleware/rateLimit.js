'use strict';

const rateLimit = require('express-rate-limit');

// Limiter general: protege toda la API de abuso.
// 100 peticiones por minuto por IP.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera un momento e intenta de nuevo.' },
});

// Limiter estricto para autenticacion: frena ataques de fuerza bruta.
// 10 peticiones por minuto por IP en /api/auth/*.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticacion. Espera un minuto.' },
});

module.exports = { generalLimiter, authLimiter };
