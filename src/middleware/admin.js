'use strict';

const prisma = require('../lib/prisma');

// Lee ADMIN_EMAILS (lista separada por comas) y devuelve un Set normalizado
// (lowercase + trim). Se evalua en cada request para que un cambio de env en
// Render aplique sin re-deploy del codigo.
function getAdminEmails() {
  return new Set(
    String(process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

// Exige que el usuario autenticado sea administrador.
// Es admin si:
//   - su rol es ADMIN, O
//   - su email esta en la allowlist ADMIN_EMAILS (case-insensitive).
// La allowlist permite designar al dueno como admin sin exponer registro ADMIN.
// Se usa SIEMPRE despues de requireAuth (necesita req.user.sub / req.user.role).
async function requireAdmin(req, res, next) {
  try {
    if (req.user && req.user.role === 'ADMIN') {
      return next();
    }

    const adminEmails = getAdminEmails();
    if (req.user && req.user.sub && adminEmails.size > 0) {
      // El JWT solo trae { sub, role }, no el email: lo buscamos en la BD.
      const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { email: true },
      });
      if (user && adminEmails.has(String(user.email).trim().toLowerCase())) {
        return next();
      }
    }

    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAdmin };
