'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { signToken } = require('../lib/token');
const sanitizeUser = require('../lib/sanitizeUser');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['PASSENGER', 'DRIVER', 'COURIER', 'ADMIN'];

// POST /api/auth/register
async function register(req, res, next) {
  try {
    const { fullName, email, password, phone, role, city } = req.body || {};

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'fullName, email y password son obligatorios' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'El email no es valido' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'La contrasena debe tener al menos 6 caracteres' });
    }
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'El rol indicado no es valido' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

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
        fullName,
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

    const normalizedEmail = String(email).trim().toLowerCase();
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

module.exports = { register, login };
