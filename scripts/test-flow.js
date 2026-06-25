'use strict';

// Prueba end-to-end del flujo de auth usando fetch nativo (Node 18+).
// Levanta el server aparte (npm run dev) y ejecuta: node scripts/test-flow.js

const BASE = process.env.BASE_URL || 'http://localhost:4000';

async function main() {
  const out = {};

  // 1) health
  const health = await fetch(`${BASE}/health`);
  out.health = { status: health.status, body: await health.json() };

  // 2) register (email unico por corrida)
  const email = `test_${Date.now()}@jahapy.test`;
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Ana Lopez',
      email,
      password: 'secret123',
      phone: `+59598${Date.now().toString().slice(-7)}`,
      role: 'PASSENGER',
      city: 'Asuncion',
    }),
  });
  const regBody = await regRes.json();
  out.register = { status: regRes.status, body: regBody };

  const token = regBody.token;

  // 3) login
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret123' }),
  });
  out.login = { status: loginRes.status, body: await loginRes.json() };

  // 4) me con token
  const meRes = await fetch(`${BASE}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  out.me = { status: meRes.status, body: await meRes.json() };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('ERROR en test-flow:', err);
  process.exit(1);
});
