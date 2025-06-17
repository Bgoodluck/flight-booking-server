const express = require('express');
const PaymentController = require('../controllers/paymentController');
const { authenticateToken, apiLimiter, requirePartner, requireUser } = require('../middleware/auth');

const router = express.Router();
const paymentController = new PaymentController();

// Webhook route (no authentication required for external services)
router.post('/webhook/flutterwave', 
  express.raw({ type: 'application/json' }), // Parse raw body for webhook signature verification
  paymentController.handleFlutterwaveWebhook.bind(paymentController)
);


// Apply authentication and rate limiting to all routes
router.use(authenticateToken);
router.use(apiLimiter);

// Payment processing routes
router.post('/process', paymentController.processPayment.bind(paymentController));
router.get('/verify/:transactionId', paymentController.verifyPayment.bind(paymentController));

// Wallet management routes
router.post('/wallet/fund', paymentController.fundWallet.bind(paymentController));
router.get('/wallet/balance', paymentController.getWalletBalance.bind(paymentController));
router.get('/wallet/transactions', paymentController.getWalletTransactions.bind(paymentController));
router.post('/wallet/withdraw', paymentController.withdrawFromWallet.bind(paymentController));
router.get('/wallet/withdrawals', paymentController.getWithdrawalHistory.bind(paymentController));

// Payment history and tracking
router.get('/history',requireUser, paymentController.getPaymentHistory.bind(paymentController));
router.get('/booking/:bookingId', paymentController.getBookingPayments.bind(paymentController));
router.get('/stats', paymentController.getPaymentStats.bind(paymentController));

// Admin routes (require admin privileges)
router.post('/cash/update', requirePartner, paymentController.updateCashPaymentStatus.bind(paymentController));
router.get('/admin/all', requirePartner, paymentController.getAllPayments.bind(paymentController));


module.exports = router;