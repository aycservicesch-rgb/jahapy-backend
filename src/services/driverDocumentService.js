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

module.exports = { DOC_KINDS, saveDocument, getDocuments };
