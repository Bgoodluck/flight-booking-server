const express = require('express');
const AdminAuthController = require('../controllers/adminAuthController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();
const adminAuthController = new AdminAuthController();

// ✅ PUBLIC ROUTES - No authentication required
router.post('/login', adminAuthController.login);

// ✅ PROTECTED ROUTES - Authentication required
router.use(authenticateToken);
router.use(authorizeRoles('admin'));

// Token validation endpoint
router.get('/validate', adminAuthController.validate);
router.post('/logout', adminAuthController.logout);

module.exports = router;