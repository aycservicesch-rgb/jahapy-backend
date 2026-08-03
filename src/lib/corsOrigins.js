'use strict';

// Origenes permitidos para CORS (Express y Socket.IO).
// Se configuran con la env CORS_ORIGIN (lista separada por comas).
// Si no esta seteada, se usan los defaults de desarrollo + el frontend desplegado.

// Dominios de PRODUCCIÓN de Jahapy: SIEMPRE permitidos (no dependen de la env,
// para que un CORS_ORIGIN mal configurado nunca deje la app sin conexión).
const PROD_ORIGINS = [
  'https://jahapy.net.py',
  'https://www.jahapy.net.py',
  'https://jahapy-py.netlify.app',
  'https://jocular-cat-10b938.netlify.app',
];

const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
];

const DEFAULT_ORIGINS = [...PROD_ORIGINS, ...DEV_ORIGINS];

function getAllowedOrigins() {
  const raw = process.env.CORS_ORIGIN;
  const fromEnv = raw && raw.trim()
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  // Producción + dev + lo que diga la env (sin duplicar).
  return [...new Set([...PROD_ORIGINS, ...DEV_ORIGINS, ...fromEnv])];
}

module.exports = { getAllowedOrigins, DEFAULT_ORIGINS };
