'use strict';

const isProd = () => process.env.NODE_ENV === 'production';

// Middleware central de manejo de errores.
// En produccion NO expone stack traces ni detalles internos: loguea el error
// completo en el server pero responde un mensaje generico. En dev, mantiene
// el detalle (mensaje + stack) para depurar.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Siempre logueamos el error completo del lado del servidor.
  console.error('[error]', err);

  const status = err.status || 500;

  if (isProd()) {
    // En produccion: nunca filtrar detalles internos en errores 500.
    const message = status >= 500 ? 'Error interno del servidor' : err.message;
    return res.status(status).json({ error: message || 'Error interno del servidor' });
  }

  // En desarrollo: detalle util para depurar.
  const message = status === 500 ? 'Error interno del servidor' : err.message;
  return res.status(status).json({ error: message, stack: err.stack });
}

// 404 para rutas no encontradas.
function notFound(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

module.exports = { errorHandler, notFound };
