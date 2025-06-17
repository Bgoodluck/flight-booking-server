const BookingService = require('../services/bookingService'); 
const bookingService = new BookingService();

class BookingController {
async createBooking(req, res) {
  try {
    console.log('=== BOOKING REQUEST START ===');
    console.log('Request headers:', req.headers);
    console.log('Request user:', req.user);
    console.log('Request body keys:', Object.keys(req.body));
    
    // Enhanced authentication check
    if (!req.user || !req.user.id) {
      console.error('Authentication failed - no user or user ID');
      return res.status(401).json({ 
        error: 'User authentication required',
        details: 'Please log in and try again'
      });
    }

    // Validate user ID format (should be UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(req.user.id)) {
      console.error('Invalid user ID format:', req.user.id);
      return res.status(400).json({ 
        error: 'Invalid user ID format',
        details: 'User ID must be a valid UUID'
      });
    }

    const partnerId = req.headers['x-partner-id'] || null;
    console.log('Partner ID from header:', partnerId);
    
    // Validate partner ID format if provided
    if (partnerId && !uuidRegex.test(partnerId)) {
      console.error('Invalid partner ID format:', partnerId);
      return res.status(400).json({ 
        error: 'Invalid partner ID format',
        details: 'Partner ID must be a valid UUID'
      });
    }
    
    const result = await bookingService.createBooking(req.body, req.user.id, partnerId);
    
    console.log('=== BOOKING REQUEST SUCCESS ===');
    console.log('Result:', result);
    
    res.status(201).json({
      success: true,
      booking: result.booking,
      bookingId: result.booking.id,
      bookingReference: result.bookingReference,
      message: 'Booking created successfully'
    });
    
  } catch (error) {
    console.error('=== BOOKING REQUEST ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Provide specific error responses based on error type
    let statusCode = 400;
    let errorResponse = {
      error: error.message || 'Failed to create booking'
    };

    // Handle specific database constraint errors
    if (error.message && error.message.includes('user_id') && error.message.includes('not present')) {
      statusCode = 404;
      errorResponse = {
        error: 'User not found',
        details: 'Your user account could not be found. Please log out and log back in.',
        code: 'USER_NOT_FOUND'
      };
    } else if (error.message && error.message.includes('partner_id') && error.message.includes('not present')) {
      statusCode = 404;
      errorResponse = {
        error: 'Partner not found',
        details: 'The specified partner could not be found.',
        code: 'PARTNER_NOT_FOUND'
      };
    } else if (error.message && error.message.includes('Flight price information is missing')) {
      statusCode = 400;
      errorResponse = {
        error: 'Invalid flight data',
        details: 'Flight pricing information is missing or invalid.',
        code: 'INVALID_FLIGHT_DATA'
      };
    } else if (error.message && error.message.includes('At least one passenger is required')) {
      statusCode = 400;
      errorResponse = {
        error: 'Passenger information required',
        details: 'At least one passenger must be provided for the booking.',
        code: 'MISSING_PASSENGERS'
      };
    }

    // Add development details if in development mode
    if (process.env.NODE_ENV === 'development') {
      errorResponse.stack = error.stack;
    }
    
    res.status(statusCode).json(errorResponse);
  }
}

  async getUserBookings(req, res) {
    try {
      const bookings = await bookingService.getUserBookings(req.user.id);
      res.json(bookings);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getBookingDetails(req, res) {
    try {
      const { bookingId } = req.params;
      const partnerId = req.user.role === 'partner' ? req.user.id : null;
      const userId = req.user.role === 'user' ? req.user.id : null;
      
      const booking = await bookingService.getBookingDetails(bookingId, userId, partnerId);
      res.json(booking);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

//   async cancelBooking(req, res) {
//   try {
//     const { bookingId } = req.params;
//     const { reason } = req.body;
//     const userId = req.user.id;

//     console.log(`Cancelling booking ${bookingId} for user ${userId}`);

//     const result = await this.bookingService.cancelBooking(bookingId, userId, reason || 'Customer request');
    
//     res.json({
//       success: true,
//       message: result.message,
//       refundAmount: result.refundAmount
//     });
//   } catch (error) {
//     console.error('Cancel booking error:', error);
//     res.status(400).json({ 
//       success: false,
//       error: error.message 
//     });
//   }
// }



  async modifyBooking(req, res) {
    try {
      const { bookingId } = req.params;
      const result = await bookingService.modifyBooking(bookingId, req.user.id, req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // New confirm booking method
  async confirmBooking(req, res) {
    try {
      const { bookingId } = req.params;
      const { paymentData, status } = req.body;
      
      const result = await bookingService.confirmBooking(
        bookingId, 
        req.user.id, 
        paymentData, 
        status
      );
      
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async cancelBooking(req, res) {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    console.log(`Cancelling booking ${bookingId} for user ${userId}`);

    // Fix: Use bookingService instead of this.bookingService
    const result = await bookingService.cancelBooking(bookingId, userId, reason || 'Customer request');
    
    res.json({
      success: true,
      message: result.message,
      refundAmount: result.refundAmount
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
}

// Fixed downloadTicket method
async downloadTicket(req, res) {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    console.log(`Generating ticket for booking ${bookingId} and user ${userId}`);

    // First verify the booking belongs to the user
    // Fix: Use bookingService instead of this.bookingService
    const booking = await bookingService.getBookingDetails(bookingId, userId);
    
    if (!booking) {
      return res.status(404).json({ 
        success: false,
        error: 'Booking not found or access denied' 
      });
    }

    // Check if booking is confirmed
    if (booking.status !== 'confirmed') {
      return res.status(400).json({ 
        success: false,
        error: 'Ticket can only be downloaded for confirmed bookings' 
      });
    }

    // Generate the ticket PDF
    // Fix: Use bookingService instead of this.bookingService
    const ticketBuffer = await bookingService.generateTicket(booking);
    
    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=ticket-${booking.booking_reference}.pdf`);
    res.setHeader('Content-Length', ticketBuffer.length);
    
    // Send the PDF buffer
    res.send(ticketBuffer);

  } catch (error) {
    console.error('Download ticket error:', error);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
}
}

module.exports = BookingController;