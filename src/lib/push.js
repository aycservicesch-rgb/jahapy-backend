'use strict';

// ============================================================
//  WEB PUSH (notificaciones con la app cerrada) — VAPID
//  Degradación segura: si no hay llaves VAPID en el entorno, el
//  módulo queda deshabilitado y NADA se rompe (las funciones son no-op).
//  Fase 2: mover las suscripciones de memoria a la base de datos.
// ============================================================

const webpush = require('web-push');

const PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:aycservices.ch@gmail.com';
const enabled = !!(PUBLIC && PRIVATE);

if (enabled) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    console.log('[push] Web Push habilitado (VAPID configurado)');
  } catch (e) {
    console.error('[push] Error configurando VAPID:', e.message);
  }
} else {
  console.log('[push] Web Push deshabilitado (faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
}

// Suscripciones en memoria: userId -> subscription
const subs = new Map();

function saveSubscription(userId, subscription) {
  if (!userId || !subscription || !subscription.endpoint) return false;
  subs.set(String(userId), subscription);
  return true;
}

function removeSubscription(userId) {
  subs.delete(String(userId));
}

// Envía una notificación push a un usuario (si está suscrito). Nunca lanza.
async function sendToUser(userId, payload) {
  if (!enabled) return;
  const sub = subs.get(String(userId));
  if (!sub) return;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
  } catch (err) {
    // 404/410 = suscripción vencida → descartar
    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
      subs.delete(String(userId));
    }
  }
}

module.exports = { enabled, publicKey: PUBLIC, saveSubscription, removeSubscription, sendToUser };
