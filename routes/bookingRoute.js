// Fixed BookingRoute.js
const express = require('express');
const BookingController = require('../controllers/bookingController'); 
const { authenticateToken, apiLimiter } = require('../middleware/auth');

const router = express.Router();
const bookingController = new BookingController();

router.use(authenticateToken);
router.use(apiLimiter);

router.post('/', bookingController.createBooking.bind(bookingController));
router.get('/', bookingController.getUserBookings.bind(bookingController));
router.get('/:bookingId', bookingController.getBookingDetails.bind(bookingController));
router.put('/:bookingId/cancel', bookingController.cancelBooking.bind(bookingController));
router.put('/:bookingId/modify', bookingController.modifyBooking.bind(bookingController));
router.put('/:bookingId/confirm', bookingController.confirmBooking.bind(bookingController));
router.get('/:bookingId/ticket', bookingController.downloadTicket.bind(bookingController));

module.exports = router;