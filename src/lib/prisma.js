'use strict';

const { PrismaClient } = require('@prisma/client');

// Instancia unica de Prisma reutilizada en toda la app.
const prisma = new PrismaClient();

module.exports = prisma;
