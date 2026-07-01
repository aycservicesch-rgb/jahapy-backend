'use strict';

const pagopar = require('../lib/pagopar');
const commissionService = require('../services/commissionService');

// POST /api/payments/pagopar/webhook   (PUBLICO — validado por token SHA1)
// Pagopar notifica aca cuando cambia el estado de un pedido. Validamos el token
// (sha1(private_key + hash_pedido)) para asegurar que viene de Pagopar y no de
// un tercero. Si es un pago de comision confirmado, descontamos la deuda.
//
// La URL de este webhook se configura en el panel de comercio de Pagopar/upay.
async function pagoparWebhook(req, res) {
  try {
    const body = req.body || {};
    // Pagopar puede enviar los datos en la raiz o dentro de `resultado`.
    const payload = Array.isArray(body.resultado) ? (body.resultado[0] || {}) : body;
    const hashPedido = payload.hash_pedido || body.hash_pedido;
    const token = payload.token || body.token;
    const idPedido = payload.id_pedido_comercio || body.id_pedido_comercio;

    if (!hashPedido || !token) {
      return res.status(400).json({ respuesta: false, error: 'faltan datos' });
    }

    // Seguridad: el token debe coincidir con el que genera el comercio.
    if (!pagopar.verifyWebhook(hashPedido, token)) {
      return res.status(401).json({ respuesta: false, error: 'token invalido' });
    }

    // Confirmar el pago de comision (doble-verifica el estado contra Pagopar).
    if (idPedido) {
      await commissionService.confirmPagoparPayment(idPedido, hashPedido);
    }

    // Pagopar espera un 200; devolvemos el token como acuse (patron habitual).
    return res.json({ respuesta: true, resultado: token });
  } catch (err) {
    console.error('[payments] pagoparWebhook error', err.message);
    // 200 para que Pagopar no reintente en loop ante un error interno nuestro.
    return res.status(200).json({ respuesta: true });
  }
}

module.exports = { pagoparWebhook };
