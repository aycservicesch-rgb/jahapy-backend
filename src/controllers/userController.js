'use strict';

const prisma = require('../lib/prisma');
const sanitizeUser = require('../lib/sanitizeUser');

// GET /api/me  (requiere auth)
async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    return res.json({ user: sanitizeUser(user) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { me };
