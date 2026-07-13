'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Crea un token de recuperación para el email (si existe el usuario).
// Devuelve { rawToken, user } o null si no hay usuario (el caller responde
// éxito igual, para no revelar qué emails están registrados).
async function createResetToken(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, fullName: true },
  });
  if (!user) return null;

  const rawToken = crypto.randomBytes(32).toString('hex');
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return { rawToken, user };
}

// Cambia la contraseña usando un token válido (no vencido, no usado).
// Devuelve { ok:true } o { error }.
async function resetPassword(rawToken, newPassword) {
  const pass = String(newPassword || '');
  if (pass.length < 6 || pass.length > 128) {
    return { error: 'La contraseña debe tener entre 6 y 128 caracteres' };
  }
  const tokenHash = sha256(String(rawToken || ''));
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    return { error: 'El enlace no es válido o ya venció. Pedí uno nuevo.' };
  }

  const passwordHash = await bcrypt.hash(pass, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    // Invalidar cualquier otro token pendiente de ese usuario.
    prisma.passwordReset.updateMany({
      where: { userId: reset.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
  return { ok: true };
}

module.exports = { createResetToken, resetPassword };
