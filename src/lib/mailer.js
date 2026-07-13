'use strict';

// ============================================================
//  MAILER — envío de emails (env-gated, degradación elegante)
//
//  Igual patrón que push/uenoPay/pagopar: si NO están las variables de
//  entorno de SMTP, isEnabled() = false y send() no hace nada (no rompe).
//  La app sigue funcionando; el reset queda creado pero sin email enviado.
//
//  Para ACTIVAR con Gmail (gratis), cargá en Render → Environment:
//     SMTP_USER = tu-correo@gmail.com
//     SMTP_PASS = (Contraseña de aplicación de Google, 16 letras, NO tu clave
//                  normal — se genera en myaccount.google.com/apppasswords con
//                  la verificación en 2 pasos activada)
//     MAIL_FROM = "Jahapy <tu-correo@gmail.com>"   (opcional)
//  O con otro proveedor (Resend/Brevo/SendGrid SMTP):
//     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//
//  Las credenciales SOLO viven en Render, NUNCA en el repo.
// ============================================================

const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const FROM = process.env.MAIL_FROM || (USER ? `Jahapy <${USER}>` : '');

let transporter = null;

function isEnabled() {
  return !!USER && !!PASS;
}

function getTransport() {
  if (!isEnabled()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465, // 465 = SSL; 587 = STARTTLS
      auth: { user: USER, pass: PASS },
    });
  }
  return transporter;
}

// Envía un email. Nunca lanza: devuelve { ok } y loguea el error.
async function send({ to, subject, html, text }) {
  const tx = getTransport();
  if (!tx) return { ok: false, reason: 'mailer_disabled' };
  try {
    await tx.sendMail({ from: FROM, to, subject, html, text });
    return { ok: true };
  } catch (err) {
    console.error('[mailer] error al enviar:', err.message);
    return { ok: false, reason: 'send_error', error: err.message };
  }
}

// Email de recuperación de contraseña con el enlace de reset.
async function sendPasswordReset(to, resetUrl) {
  const subject = 'Recuperá tu contraseña de Jahapy';
  const text = `Recibimos un pedido para restablecer tu contraseña de Jahapy.\n\nEntrá a este enlace (válido por 1 hora):\n${resetUrl}\n\nSi no lo pediste, ignorá este correo.`;
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
    <div style="text-align:center;margin-bottom:16px">
      <span style="font-size:28px;font-weight:800">Jaha<span style="color:#D52B1E">py</span></span>
    </div>
    <h2 style="font-size:20px">Recuperá tu contraseña</h2>
    <p>Recibimos un pedido para restablecer tu contraseña. Tocá el botón para crear una nueva (el enlace vence en 1 hora):</p>
    <p style="text-align:center;margin:28px 0">
      <a href="${resetUrl}" style="background:#D52B1E;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px;display:inline-block">Cambiar contraseña</a>
    </p>
    <p style="font-size:13px;color:#666">Si el botón no funciona, copiá y pegá este enlace:<br><a href="${resetUrl}">${resetUrl}</a></p>
    <p style="font-size:13px;color:#666">Si no pediste esto, ignorá este correo. Tu contraseña no cambia hasta que uses el enlace.</p>
    <p style="font-size:12px;color:#999;margin-top:24px">Jahapy · Paraguay 🇵🇾</p>
  </div>`;
  return send({ to, subject, html, text });
}

module.exports = { isEnabled, send, sendPasswordReset };
