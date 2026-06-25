'use strict';

const { verifyToken } = require('../lib/token');

// Verifica el header Authorization: Bearer <token>.
// Si es valido, agrega req.user = { id, role, ... } y continua.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Falta el token de autenticacion' });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload; // { sub: userId, role }
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado' });
  }
}

module.exports = { requireAuth };
