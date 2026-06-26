'use strict';

const prisma = require('../lib/prisma');

const PROFILE_STATUSES = ['pending', 'approved', 'rejected'];

// Crea o actualiza el BusinessProfile del usuario (su comercio principal).
// Para el MVP: 1 comercio por dueno (se busca el primero por ownerId).
// Al (re)aplicar queda en 'pending'.
async function applyBusiness(ownerId, data = {}) {
  const fields = {
    name: String(data.name),
    category: data.category ? String(data.category) : null,
    address: data.address ? String(data.address) : null,
    phone: data.phone ? String(data.phone) : null,
    menu: data.menu != null ? JSON.stringify(data.menu) : null,
  };

  const existing = await prisma.businessProfile.findFirst({ where: { ownerId } });
  if (existing) {
    return prisma.businessProfile.update({
      where: { id: existing.id },
      data: { ...fields, status: 'pending' },
    });
  }
  return prisma.businessProfile.create({
    data: { ownerId, status: 'pending', ...fields },
  });
}

async function getByOwnerId(ownerId) {
  return prisma.businessProfile.findFirst({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
  });
}

async function getById(id) {
  return prisma.businessProfile.findUnique({ where: { id } });
}

// Admin: lista de comercios por estado (default pending).
async function listByStatus(status) {
  const where = status ? { status } : {};
  return prisma.businessProfile.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { owner: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
}

// Admin: cambia el estado de un comercio por su id.
async function setStatus(id, status) {
  if (!PROFILE_STATUSES.includes(status)) return { error: 'Estado invalido' };
  const profile = await prisma.businessProfile.findUnique({ where: { id } });
  if (!profile) return { error: 'Comercio no encontrado' };
  const updated = await prisma.businessProfile.update({
    where: { id },
    data: { status },
    include: { owner: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  return { profile: updated };
}

module.exports = {
  PROFILE_STATUSES,
  applyBusiness,
  getByOwnerId,
  getById,
  listByStatus,
  setStatus,
};
