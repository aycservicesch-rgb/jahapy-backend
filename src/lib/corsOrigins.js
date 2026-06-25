'use strict';

// Origenes permitidos para CORS (Express y Socket.IO).
// Se configuran con la env CORS_ORIGIN (lista separada por comas).
// Si no esta seteada, se usan los defaults de desarrollo + el frontend desplegado.

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://jocular-cat-10b938.netlify.app',
];

function getAllowedOrigins() {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || !raw.trim()) return DEFAULT_ORIGINS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = { getAllowedOrigins, DEFAULT_ORIGINS };
