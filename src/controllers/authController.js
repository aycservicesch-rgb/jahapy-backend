'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { signToken } = require('../lib/token');
const sanitizeUser = require('../lib/sanitizeUser');
const mailer = require('../lib/mailer');
const passwordResetService = require('../services/passwordResetService');

const APP_URL = (process.env.APP_URL || 'https://jahapy.net.py').replace(/\/$/, '');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['PASSENGER', 'DRIVER', 'COURIER', 'ADMIN'];

// POST /api/auth/register
async function register(req, res, next) {
  try {
    const { fullName, email, password, phone, role, city } = req.body || {};

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'fullName, email y password son obligatorios' });
    }
    if (typeof fullName !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'fullName, email y password deben ser texto' });
    }
    const cleanName = fullName.trim();
    if (cleanName.length < 2 || cleanName.length > 120) {
      return res.status(400).json({ error: 'El nombre debe tener entre 2 y 120 caracteres' });
    }
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'El email no es valido' });
    }
    if (password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: 'La contrasena debe tener entre 6 y 128 caracteres' });
    }
    if (phone != null && (typeof phone !== 'string' || phone.length > 30)) {
      return res.status(400).json({ error: 'El telefono no es valido' });
    }
    if (city != null && (typeof city !== 'string' || city.length > 120)) {
      return res.status(400).json({ error: 'La ciudad no es valida' });
    }
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'El rol indicado no es valido' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: 'El email ya esta registrado' });
    }

    if (phone) {
      const existingPhone = await prisma.user.findUnique({ where: { phone } });
      if (existingPhone) {
        return res.status(409).json({ error: 'El telefono ya esta registrado' });
      }
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await prisma.user.create({
      data: {
        fullName: cleanName,
        email: normalizedEmail,
        phone: phone || null,
        passwordHash,
        role: role || 'PASSENGER',
        city: city || null,
      },
    });

    const token = signToken({ sub: user.id, role: user.role });
    return res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    return next(err);
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email y password son obligatorios' });
    }
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'email y password deben ser texto' });
    }
    if (email.length > 254 || password.length > 128) {
      return res.status(400).json({ error: 'Credenciales invalidas' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const token = signToken({ sub: user.id, role: user.role });
    return res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    return next(err);
  }
}

// POST /api/auth/forgot-password  { email }
// Genera un token y envía el email con el enlace de reset. Responde genérico
// (no revela si el email está registrado) por seguridad.
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Ingresá tu email' });
    }
    const result = await passwordResetService.createResetToken(email);
    if (result) {
      const link = `${APP_URL}/?reset=${result.rawToken}`;
      await mailer.sendPasswordReset(result.user.email, link);
    }
    // sent indica si el mailer está configurado (para el mensaje del front).
    return res.json({ ok: true, sent: mailer.isEnabled() });
  } catch (err) {
    return next(err);
  }
}

// POST /api/auth/reset-password  { token, password }
async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: 'Falta el token o la nueva contraseña' });
    }
    const result = await passwordResetService.resetPassword(token, password);
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, forgotPassword, resetPassword };
