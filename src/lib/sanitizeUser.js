'use strict';

// Devuelve el usuario sin el campo passwordHash, para respuestas de la API.
function sanitizeUser(user) {
  if (!user) return user;
  const { passwordHash, ...safe } = user;
  return safe;
}

module.exports = sanitizeUser;
