'use strict';

// Exige que el usuario autenticado tenga rol ADMIN.
// Se usa SIEMPRE despues de requireAuth (necesita req.user).
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  return next();
}

module.exports = { requireAdmin };
