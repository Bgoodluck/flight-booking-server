// routes/flights.js
const express = require('express');
const router = express.Router();
const flightController = require('../controllers/flightController');
const { authenticateToken, apiLimiter, authenticatePartnerToken } = require('../middleware/auth');

// Apply rate limiting to all flight routes
router.use(apiLimiter);

// Flight search routes
router.post('/search', flightController.searchFlights);
router.get('/details/:flightId', flightController.getFlightDetails);
router.get('/fare-rules/:flightId', flightController.getFareRules);

// Airport and airline routes
router.get('/airports/search', flightController.searchAirports);
router.get('/destinations/popular', flightController.getPopularDestinations);
router.get('/airlines', flightController.getAirlines);

// Protected routes that require authentication
router.post('/price-alerts', authenticateToken, flightController.createPriceAlert);
router.get('/price-alerts', authenticateToken, flightController.getUserPriceAlerts);
router.put('/price-alerts/:alertId', authenticateToken, flightController.updatePriceAlert);
router.delete('/price-alerts/:alertId', authenticateToken, flightController.deletePriceAlert);

// Price calendar route
router.get('/calendar/:route', flightController.getPriceCalendar);

// Search history (protected)
router.get('/history', authenticateToken, flightController.getSearchHistory);
router.delete('/history/:searchId', authenticateToken, flightController.deleteSearchHistory);

// Flight comparison and favorites (protected)
router.post('/favorites', authenticateToken, flightController.addToFavorites);
router.get('/favorites', authenticateToken, flightController.getFavorites);
router.delete('/favorites/:flightId', authenticateToken, flightController.removeFromFavorites);

module.exports = router;