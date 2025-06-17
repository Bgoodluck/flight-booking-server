const express = require('express');
const AdminController = require('../controllers/adminController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();
const adminController = new AdminController();

// Apply authentication and authorization middleware to all admin routes
router.use(authenticateToken);
router.use(authorizeRoles('admin'));

// Dashboard
router.get('/dashboard', adminController.getDashboard);

// Users management
router.get('/users', adminController.getAllUsers);
router.put('/users/:action/:userId', adminController.manageUsers);

// Partners management
router.get('/partners', adminController.getAllPartners);
router.put('/partners/:action/:partnerId', adminController.managePartners);
router.put('/payouts/:payoutId/approve', adminController.approvePayout);

// Bookings management
router.get('/bookings', adminController.getAllBookings);
router.get('/bookings/:bookingId', adminController.getBookingDetails);

// Refunds management
router.get('/refunds', adminController.getAllRefunds);
router.put('/refunds/:refundId/:action', adminController.processRefund);

// Reports
router.get('/reports/:reportType', adminController.generateReports);

// Promo codes management
router.post('/promo-codes/:action', adminController.managePromoCodes);
router.put('/promo-codes/:action', adminController.managePromoCodes);

// System management
router.get('/system/logs', adminController.getSystemLogs);
router.get('/system/settings', adminController.getSystemSettings);
router.put('/system/settings', adminController.updateSystemSettings);

// Notifications
router.post('/notifications', adminController.sendNotification);

module.exports = router;