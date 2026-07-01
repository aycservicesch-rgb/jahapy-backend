'use strict';

// ============================================================
//  UENO / UPAY — verificacion de transferencias (env-gated)
//
//  Igual patron que lib/push.js: DEGRADACION ELEGANTE.
//   - Si NO estan las variables de entorno (UENO_API_KEY / UENO_API_URL),
//     isEnabled() = false y verifyTransfer() devuelve { verified:false,
//     reason:'disabled' }. El pago de comision queda PENDIENTE de que el
//     admin lo confirme a mano. La app funciona igual, sin ueno.
//   - Cuando cargues las credenciales de ueno en Render (Environment), esto
//     pasa a verificar la transferencia AUTOMATICAMENTE, sin tocar codigo.
//
//  IMPORTANTE (seguridad): las credenciales SOLO se leen de process.env.
//  NUNCA se ponen en el repo. Cargalas en Render -> Environment:
//     UENO_API_URL   = (endpoint que te de ueno para consultar transferencias)
//     UENO_API_KEY   = (tu token/clave de la API de ueno)
//     UENO_ALIAS     = 6828278   (tu alias de cobro)
//
//  NOTA: el contrato exacto de la API de ueno (ruta, headers, forma de la
//  respuesta) hay que ajustarlo a la documentacion que te entregue ueno.
//  Dejamos un mapeo razonable y TODOs claros donde adaptarlo.
// ============================================================

const API_URL = process.env.UENO_API_URL || '';
const API_KEY = process.env.UENO_API_KEY || '';
const ALIAS = process.env.UENO_ALIAS || '6828278';

// ¿Esta configurada la verificacion automatica?
function isEnabled() {
  return !!API_URL && !!API_KEY;
}

// Verifica que exista una transferencia ENTRANTE al alias por >= amount,
// idealmente identificada por `reference` (nro de comprobante).
// Devuelve { verified: boolean, reason?: string, raw?: any }.
// NUNCA lanza: ante cualquier error devuelve verified:false (queda pendiente).
async function verifyTransfer({ amount, reference } = {}) {
  if (!isEnabled()) return { verified: false, reason: 'disabled' };
  if (!(Number(amount) > 0)) return { verified: false, reason: 'bad_amount' };

  try {
    // TODO(ueno): ajustar a la API real de ueno. Este es el esqueleto:
    // consulta las transferencias recibidas al alias y busca una que coincida
    // en monto (y referencia si la hay) dentro de una ventana reciente.
    const url = `${API_URL.replace(/\/$/, '')}/transfers?alias=${encodeURIComponent(ALIAS)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return { verified: false, reason: `http_${res.status}` };

    const data = await res.json().catch(() => null);
    const list = Array.isArray(data) ? data : (data && data.transfers) || [];

    // Coincidencia: monto suficiente y (si se paso) misma referencia.
    const match = list.find((t) => {
      const tAmount = Number(t.amount ?? t.monto ?? 0);
      const tRef = String(t.reference ?? t.referencia ?? t.id ?? '');
      const amountOk = tAmount >= Number(amount);
      const refOk = !reference || tRef === String(reference);
      return amountOk && refOk;
    });

    return match
      ? { verified: true, raw: match }
      : { verified: false, reason: 'not_found' };
  } catch (err) {
    // Red caida / endpoint mal / formato inesperado -> pendiente (no rompe).
    return { verified: false, reason: 'error', error: err.message };
  }
}

module.exports = { isEnabled, verifyTransfer, ALIAS };
