'use strict';

// ============================================================
//  PAGOPAR (upay) — pasarela de pago con tarjeta y QR
//
//  upay procesa los pagos e-commerce a traves de PAGOPAR. Este modulo habla
//  con la API pública de Pagopar (https://api.pagopar.com/api/).
//
//  PATRON: env-gated + degradacion elegante (igual que lib/uenoPay.js y push).
//   - Sin credenciales (PAGOPAR_PUBLIC_KEY / PAGOPAR_PRIVATE_KEY) → isEnabled()
//     = false y las funciones devuelven { ok:false, error:'pagopar_disabled' }.
//     La app funciona igual (cobro manual). CERO efecto en produccion mientras
//     no cargues las claves.
//   - Cuando upay/Pagopar te entregue las credenciales (caso 12538110), las
//     cargas en Render → Environment (NUNCA en el repo):
//         PAGOPAR_PUBLIC_KEY   = token público del comercio
//         PAGOPAR_PRIVATE_KEY  = clave privada (solo se usa para firmar SHA1;
//                                nunca se envía por la red)
//     y el pago con tarjeta/QR queda ACTIVO sin tocar mas codigo.
//
//  Seguridad: la private_key SOLO firma tokens SHA1 localmente; jamas viaja.
//  Los webhooks se validan con sha1(private_key + hash_pedido) === token.
//
//  Comercio del usuario (upay): Jahapy ULink · cod 900000000330129 · cadena LZ48FG.
//
//  NOTA: el contrato exacto (nombres de campos del body de iniciar-transaccion)
//  puede requerir ajustes finos segun la doc/sandbox que entregue Pagopar. La
//  estructura sigue la documentacion pública 2.0. Marcado con TODO donde aplica.
//  Doc: https://soporte.pagopar.com/portal/es/kb/articles/api-integracion-medios-pagos
// ============================================================

const crypto = require('crypto');

const BASE = (process.env.PAGOPAR_API_URL || 'https://api.pagopar.com/api').replace(/\/$/, '');
const PUBLIC_KEY = process.env.PAGOPAR_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.PAGOPAR_PRIVATE_KEY || '';

// Medios de pago (identificadores de Pagopar).
const FORMA_PAGO = { TARJETAS: 9, QR: 24, PIX: 25, TIGO_MONEY: 10, TRANSFERENCIA: 11 };

function isEnabled() {
  return !!PUBLIC_KEY && !!PRIVATE_KEY;
}

function sha1(str) {
  return crypto.createHash('sha1').update(String(str), 'utf8').digest('hex');
}

// Tokens SHA1 segun la doc de Pagopar.
function tokenCrearPedido(idPedido, montoTotal) {
  return sha1(`${PRIVATE_KEY}${idPedido}${montoTotal}`);
}
function tokenConsulta() {
  return sha1(`${PRIVATE_KEY}CONSULTA`);
}
function tokenWebhook(hashPedido) {
  return sha1(`${PRIVATE_KEY}${hashPedido}`);
}

// POST JSON a la API de Pagopar. Nunca lanza: devuelve { ok, status, data }.
async function postJson(path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message };
  }
}

// URL de checkout donde el comprador paga (tarjeta/QR).
function checkoutUrl(hash, formaPago) {
  const base = `https://www.pagopar.com/pagos/${hash}`;
  return formaPago ? `${base}?forma_pago=${formaPago}` : base;
}

// Crea un pedido de pago. Devuelve { ok, hash, checkoutUrl } | { ok:false, error }.
//   idPedido       : id único del comercio (usamos el id del CommissionPayment).
//   montoTotal     : guaraníes (entero).
//   comprador      : { nombre, email, documento, telefono? }.
//   items          : [{ nombre, cantidad, precio_total, ... }].
//   formaPago      : opcional (FORMA_PAGO.TARJETAS / .QR). Si se omite, el
//                    comprador elige en el checkout.
//   fechaMaximaPago: 'YYYY-MM-DD HH:mm:ss' (vencimiento de la orden).
async function createOrder({ idPedido, montoTotal, comprador = {}, items, formaPago, fechaMaximaPago }) {
  if (!isEnabled()) return { ok: false, error: 'pagopar_disabled' };
  const monto = String(Math.round(Number(montoTotal) || 0));
  if (monto === '0') return { ok: false, error: 'monto_invalido' };

  const body = {
    token: tokenCrearPedido(idPedido, monto),
    public_key: PUBLIC_KEY,
    monto_total: monto,
    tipo_pedido: 'VENTA-COMERCIO',
    compras_items: Array.isArray(items) && items.length ? items : [
      { ciudad: 1, nombre: 'Comisión Jahapy', cantidad: 1, categoria: '909', public_key: PUBLIC_KEY, url_imagen: '', descripcion: 'Comisión', precio_total: Number(monto) },
    ],
    comprador: {
      ruc: comprador.documento || '',
      email: comprador.email || '',
      ciudad: comprador.ciudad || 1,
      nombre: comprador.nombre || 'Cliente Jahapy',
      telefono: comprador.telefono || '',
      direccion: comprador.direccion || '',
      documento: comprador.documento || '',
      coordenadas: '',
      razon_social: comprador.nombre || '',
      tipo_documento: 'CI',
      direccion_referencia: '',
    },
    id_pedido_comercio: String(idPedido),
    fecha_maxima_pago: fechaMaximaPago,
    ...(formaPago ? { forma_pago: formaPago } : {}),
  };

  const { ok, data } = await postJson('/comercios/2.0/iniciar-transaccion', body);
  if (!ok || !data || data.respuesta !== true) {
    return { ok: false, error: 'pagopar_error', raw: data };
  }
  const hash = data.resultado && data.resultado[0] && data.resultado[0].data;
  if (!hash) return { ok: false, error: 'sin_hash', raw: data };
  return { ok: true, hash, checkoutUrl: checkoutUrl(hash, formaPago) };
}

// Consulta el estado real de un pedido.
// Devuelve { ok, pagado, cancelado, fechaPago, monto } | { ok:false, error }.
async function getOrderStatus(hashPedido) {
  if (!isEnabled()) return { ok: false, error: 'pagopar_disabled' };
  if (!hashPedido) return { ok: false, error: 'hash_requerido' };

  const { ok, data } = await postJson('/pedidos/1.1/traer', {
    hash_pedido: hashPedido,
    token: tokenConsulta(),
    token_publico: PUBLIC_KEY,
  });
  const r = data && data.resultado && data.resultado[0];
  if (!ok || !r) return { ok: false, error: 'sin_resultado', raw: data };
  return {
    ok: true,
    pagado: !!r.pagado,
    cancelado: !!r.cancelado,
    fechaPago: r.fecha_pago || null,
    monto: r.monto,
    formaPago: r.forma_pago,
  };
}

// Valida el token que envia el webhook de Pagopar (anti-manipulacion).
function verifyWebhook(hashPedido, tokenRecibido) {
  if (!PRIVATE_KEY || !hashPedido || !tokenRecibido) return false;
  // Comparacion en tiempo constante.
  const a = Buffer.from(tokenWebhook(hashPedido));
  const b = Buffer.from(String(tokenRecibido));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  isEnabled,
  FORMA_PAGO,
  createOrder,
  getOrderStatus,
  verifyWebhook,
  checkoutUrl,
};
