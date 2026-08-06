'use strict';

const prisma = require('../lib/prisma');

// Tipos de documento admitidos (deben coincidir con el frontend).
const DOC_KINDS = [
  'ci', 'licencia', 'selfie', 'antecedentes',   // del conductor
  'cedulaVerde', 'rtv',                          // del vehiculo
  'frente', 'atras', 'lateral', 'interior',      // fotos del vehiculo
];

// Tope de tamano de la imagen (data URL) para no reventar la BD.
// ~700 KB de base64 ≈ ~500 KB de imagen. El frontend la comprime antes.
const MAX_DATAURL_LEN = 700000;

function isValidImageDataUrl(s) {
  return typeof s === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,/.test(s);
}

// Guarda (o actualiza) una imagen de documento del conductor.
async function saveDocument(driverId, kind, dataUrl) {
  if (!DOC_KINDS.includes(kind)) return { error: 'Tipo de documento invalido' };
  if (!isValidImageDataUrl(dataUrl)) return { error: 'La imagen no es valida' };
  if (dataUrl.length > MAX_DATAURL_LEN) return { error: 'La imagen es demasiado grande' };

  const doc = await prisma.driverDocument.upsert({
    where: { driverId_kind: { driverId, kind } },
    update: { dataUrl },
    create: { driverId, kind, dataUrl },
  });
  return { doc: { id: doc.id, kind: doc.kind } };
}

// Lista los documentos (con imagen) de un conductor. Para el admin.
async function getDocuments(driverId) {
  const docs = await prisma.driverDocument.findMany({
    where: { driverId },
    select: { kind: true, dataUrl: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  return docs;
}

// VERIFICACION DE IDENTIDAD: la selfie de control caduca cada X horas. Si no
// hay selfie o esta vencida, el conductor debe sacarse una nueva ANTES de
// ponerse en linea. Esto elimina las cuentas alquiladas: siempre maneja quien
// se verifico. (Comparacion contra la foto de cedula: la hace el admin; el
// match automatico por biometria es una mejora futura con un servicio externo.)
const SELFIE_TTL_HOURS = 12;

async function getSelfieStatus(driverId) {
  const selfie = await prisma.driverDocument.findUnique({
    where: { driverId_kind: { driverId, kind: 'selfie' } },
    select: { updatedAt: true },
  });
  const ttlMs = SELFIE_TTL_HOURS * 60 * 60 * 1000;
  const takenAt = selfie ? selfie.updatedAt : null;
  const fresh = takenAt ? (Date.now() - new Date(takenAt).getTime() < ttlMs) : false;
  return {
    hasSelfie: !!selfie,
    takenAt,
    needsSelfie: !fresh,
    ttlHours: SELFIE_TTL_HOURS,
  };
}

module.exports = { DOC_KINDS, SELFIE_TTL_HOURS, saveDocument, getDocuments, getSelfieStatus };
