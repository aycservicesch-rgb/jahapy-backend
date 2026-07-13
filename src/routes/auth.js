'use strict';

const { Router } = require('express');
const { register, login, forgotPassword, resetPassword } = require('../controllers/authController');

const router = Router();

router.post('/register', register);
router.post('/login', login);
// Recuperación de contraseña por email (enlace con token, 1 uso, 1h).
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
