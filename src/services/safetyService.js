'use strict';

const prisma = require('../lib/prisma');

// Motivos de reporte (deben coincidir con el frontend).
const REPORT_REASONS = [
  'robbery_attempt', // intento de asalto
  'assault',         // agresión física
  'threat',          // amenaza
  'harassment',      // acoso
  'unsafe_driving',  // manejo peligroso
  'abuse',           // abuso / maltrato
  'other',
];

// Reportes CONFIRMADOS necesarios para suspender la cuenta.
const STRIKES_TO_SUSPEND = 2;

// Un usuario reporta a otro por un problema de seguridad en un viaje.
async function createReport(reporterId, reporterRole, { reportedId, rideId, reason, notes } = {}) {
  if (!reportedId || typeof reportedId !== 'string') return { error: 'Falta a quién reportar' };
  if (reportedId === reporterId) return { error: 'No podés reportarte a vos mismo' };
  if (!REPORT_REASONS.includes(reason)) return { error: 'Motivo inválido' };
  const role = reporterRole === 'driver' ? 'driver' : 'passenger';

  const reported = await prisma.user.findUnique({ where: { id: reportedId }, select: { id: true } });
  if (!reported) return { error: 'Usuario reportado no encontrado' };

  const report = await prisma.safetyReport.create({
    data: {
      reporterId,
      reportedId,
      rideId: rideId ? String(rideId) : null,
      reporterRole: role,
      reason,
      notes: notes != null ? String(notes).slice(0, 500) : null,
      status: 'open',
    },
  });
  return { report: { id: report.id } };
}

// Admin: lista de reportes por estado (default open), con datos de ambos usuarios.
async function listReports(status) {
  const where = status ? { status } : {};
  const reports = await prisma.safetyReport.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  // Adjuntar nombres (reporter/reported) en una sola pasada.
  const ids = [...new Set(reports.flatMap((r) => [r.reporterId, r.reportedId]))];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true, email: true, phone: true, suspended: true, safetyStrikes: true },
  });
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  return reports.map((r) => ({
    ...r,
    reporter: byId[r.reporterId] || null,
    reported: byId[r.reportedId] || null,
  }));
}

// Admin: resuelve un reporte. 'confirm' suma strike al reportado (y suspende si
// llega al umbral); 'dismiss' lo descarta.
async function resolveReport(reportId, action) {
  const report = await prisma.safetyReport.findUnique({ where: { id: reportId } });
  if (!report) return { error: 'Reporte no encontrado' };
  if (report.status !== 'open') return { error: 'El reporte ya fue resuelto' };

  if (action === 'dismiss') {
    await prisma.safetyReport.update({
      where: { id: reportId },
      data: { status: 'dismissed', resolvedAt: new Date() },
    });
    return { ok: true, status: 'dismissed' };
  }

  if (action === 'confirm') {
    const result = await prisma.$transaction(async (tx) => {
      await tx.safetyReport.update({
        where: { id: reportId },
        data: { status: 'confirmed', resolvedAt: new Date() },
      });
      const user = await tx.user.findUnique({ where: { id: report.reportedId }, select: { safetyStrikes: true } });
      const strikes = (user?.safetyStrikes || 0) + 1;
      const suspended = strikes >= STRIKES_TO_SUSPEND;
      await tx.user.update({
        where: { id: report.reportedId },
        data: {
          safetyStrikes: strikes,
          suspended,
          suspendedReason: suspended ? `Suspendido por ${strikes} reportes de seguridad confirmados` : undefined,
        },
      });
      return { strikes, suspended };
    });
    return { ok: true, status: 'confirmed', ...result };
  }

  return { error: 'Acción inválida' };
}

// ¿El usuario está suspendido? (para los gates de tiempo real).
async function isSuspended(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { suspended: true } });
  return !!(u && u.suspended);
}

// Admin: levantar la suspensión (segunda oportunidad).
async function unsuspend(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: { suspended: false, suspendedReason: null, safetyStrikes: 0 },
  });
  return { ok: true };
}

module.exports = {
  REPORT_REASONS,
  STRIKES_TO_SUSPEND,
  createReport,
  listReports,
  resolveReport,
  isSuspended,
  unsuspend,
};
