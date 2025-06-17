const express = require('express');
const { 
  authenticateToken, 
  validateUserRegistration, 
  validateLogin,
  authLimiter,
  optionalAuth,
  authenticateSupabaseToken,
  refreshSupabaseSession 
} = require('../middleware/auth');
const UserController = require('../controllers/userController');

const router = express.Router();
const userController = new UserController();

// Public routes
router.post('/register', authLimiter, validateUserRegistration, userController.register.bind(userController));
router.post('/login', authLimiter, validateLogin, userController.login.bind(userController));
router.post('/verify-email', userController.verifyEmail.bind(userController));
router.post('/forgot-password', authLimiter, userController.forgotPassword.bind(userController));
router.post('/reset-password', userController.resetPassword.bind(userController));

// Alternative login method for Supabase sessions
router.post('/login/supabase', authLimiter, userController.loginWithSupabaseSession.bind(userController));

// Token refresh endpoint
router.post('/refresh-token', userController.refreshToken.bind(userController));



// Logout endpoint
router.post('/logout', optionalAuth, userController.logout.bind(userController));

// Protected routes (require authentication)
router.use(authenticateToken);
// Session verification (useful for frontend to check if user is still logged in)
router.get('/verify-session', userController.verifySession.bind(userController));

router.get('/validate-token', userController.validateToken.bind(userController));
router.get('/profile', userController.getProfile.bind(userController));
router.put('/profile', userController.updateProfile.bind(userController));
router.delete('/account', userController.deleteAccount.bind(userController));

// Sync user data between Supabase Auth and custom table
router.post('/sync', userController.syncUserData.bind(userController));

// Alternative protected routes using Supabase-only authentication
// (uncomment if you want Supabase-specific endpoints)
/*
router.get('/profile/supabase', authenticateSupabaseToken, userController.getProfile.bind(userController));
router.put('/profile/supabase', authenticateSupabaseToken, userController.updateProfile.bind(userController));
*/

module.exports = router;


