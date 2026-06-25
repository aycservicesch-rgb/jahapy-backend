'use strict';

// Middleware central de manejo de errores.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  const status = err.status || 500;
  const message = status === 500 ? 'Error interno del servidor' : err.message;
  res.status(status).json({ error: message });
}

// 404 para rutas no encontradas.
function notFound(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

module.exports = { errorHandler, notFound };
