const { createClient } = require('@supabase/supabase-js');
const emailService = require('../utils/emailService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PDFDocument = require('pdfkit');

class BookingService {
  mapGender(gender) {
  if (!gender) return 'male';
  
  const genderMap = {
    'M': 'male',
    'F': 'female',
    'male': 'male',
    'female': 'female',
    'other': 'other'
  };
  
  return genderMap[gender] || 'male';
}
async createBooking(bookingData, userId, partnerUserId = null) {
  try {
    
    console.log('=== BOOKING CREATION START ===');
    console.log('User ID:', userId);
    console.log('Partner User ID:', partnerUserId);
    console.log('Booking Data:', JSON.stringify(bookingData, null, 2));
    
    // CRITICAL: Validate user exists first
    console.log('Validating user existence...');
    const { data: userExists, error: userCheckError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name')
      .eq('id', userId)
      .single();

    if (userCheckError || !userExists) {
      console.error('User validation failed:', userCheckError);
      console.error('User ID not found:', userId);
      throw new Error(`User with ID ${userId} not found. Please ensure the user is properly registered.`);
    }

    console.log('User validated successfully:', userExists);

    // Validate partner if provided - FIXED: Check partners table with user_id
    let partnerId = null;
    if (partnerUserId) {
      console.log('Validating partner existence...');
      const { data: partnerExists, error: partnerCheckError } = await supabase
        .from('partners')
        .select('id, commission_rate, email') // Get the partner's internal ID
        .eq('id', partnerUserId) // Assuming partners table uses 'id' field for the user ID
        .single();

      if (partnerCheckError || !partnerExists) {
        console.warn('Partner validation failed:', partnerCheckError);
        console.warn('Partner User ID not found, continuing without partner:', partnerUserId);
        partnerId = null;
      } else {
        console.log('Partner validated successfully:', partnerExists);
        partnerId = partnerExists.id; // Use the partner's ID
      }
    }

    const {
      flightOffer,
      passengers,
      contactInfo,
      paymentMethodId,
      seatSelections,
      baggageSelections,
      promoCode
    } = bookingData;

    // Validate required fields
    if (!flightOffer) {
      throw new Error('Flight offer is required');
    }
    
    if (!flightOffer.price || !flightOffer.price.total) {
      console.error('Missing price in flightOffer:', flightOffer);
      throw new Error('Flight price information is missing or invalid');
    }
    
    if (!passengers || passengers.length === 0) {
      throw new Error('At least one passenger is required');
    }
    
    if (!contactInfo || !contactInfo.email) {
      throw new Error('Contact information with email is required');
    }

    // Generate booking reference
    const bookingReference = this.generateBookingReference();
    console.log('Generated booking reference:', bookingReference);

    // Calculate total amount with proper error handling
    let totalAmount;
    try {
      totalAmount = parseFloat(flightOffer.price.total);
      console.log('Parsed total amount:', totalAmount);
    } catch (priceError) {
      console.error('Price parsing error:', priceError);
      console.error('Flight offer price:', flightOffer.price);
      throw new Error('Invalid flight price format');
    }

    if (isNaN(totalAmount) || totalAmount <= 0) {
      throw new Error(`Invalid flight price amount: ${totalAmount}`);
    }

    let discount = 0;

    // Apply promo code if provided
    if (promoCode) {
      try {
        discount = await this.applyPromoCode(promoCode, totalAmount);
        totalAmount -= discount;
        console.log(`Promo code applied. Discount: ${discount}, New total: ${totalAmount}`);
      } catch (promoError) {
        console.warn('Promo code application failed:', promoError.message);
        // Continue without promo code
      }
    }

    // Calculate commission for partner - FIXED: Use partnerId (which is the user ID)
    let commissionEarned = 0;
    if (partnerId) {
      try {
        const { data: partner, error: partnerError } = await supabase
          .from('partners')
          .select('commission_rate, available_balance, total_earnings')
          .eq('id', partnerId)
          .single();
        
        if (partnerError) throw partnerError;
        
        // Calculate commission based on partner's rate
        commissionEarned = totalAmount * (partner?.commission_rate || 0.01);
        console.log(`Partner commission calculated: ${commissionEarned} (${(partner?.commission_rate || 0.01) * 100}% of ${totalAmount})`);
      } catch (partnerError) {
        console.warn('Partner commission calculation failed:', partnerError.message);
        // Continue without commission
      }
    }

    // Determine booking type
    const bookingType = flightOffer.itineraries && flightOffer.itineraries.length > 1 ? 'roundtrip' : 'oneway';
    console.log('Booking type:', bookingType);

    // Create booking record with additional safety checks
    const bookingInsertData = {
      booking_reference: bookingReference,
      user_id: userId, // This is now validated to exist
      partner_id: partnerId, // This is the validated partner's user ID
      flight_offer: flightOffer,
      total_amount: totalAmount,
      commission_earned: commissionEarned,
      discount_amount: discount,
      promo_code: promoCode,
      contact_info: contactInfo,
      status: 'pending_payment',
      booking_type: bookingType,
      created_at: new Date().toISOString()
    };

    console.log('Inserting booking with validated data:', JSON.stringify(bookingInsertData, null, 2));

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert(bookingInsertData)
      .select()
      .single();

    if (bookingError) {
      console.error('Booking insertion error:', bookingError);
      
      // Provide more specific error messages
      if (bookingError.code === '23503') {
        if (bookingError.message.includes('user_id')) {
          throw new Error(`User validation failed. User ID ${userId} does not exist in the system.`);
        } else if (bookingError.message.includes('partner_id')) {
          throw new Error(`Partner validation failed. Partner ID ${partnerId} does not exist in the system.`);
        }
      }
      
      throw new Error(`Failed to create booking: ${bookingError.message}`);
    }

    console.log('Booking created successfully:', booking);

    // Update partner commission AFTER successful booking creation - FIXED
    if (partnerId && commissionEarned > 0) {
      await this.updatePartnerCommission(partnerId, commissionEarned, booking.id);
    }

    // Add passengers with enhanced error handling
    try {
      const passengerInserts = passengers.map((passenger, index) => ({
        booking_id: booking.id,
        first_name: passenger.firstName || passenger.first_name,
        last_name: passenger.lastName || passenger.last_name,
        date_of_birth: passenger.dateOfBirth || passenger.date_of_birth,
        gender: this.mapGender(passenger.gender),
        nationality: passenger.nationality || 'NG',
        passport_number: passenger.documentNumber || passenger.passport_number,
        passenger_type: passenger.passengerType || 'adult',
        created_at: new Date().toISOString()
      }));

      console.log('Inserting passengers:', JSON.stringify(passengerInserts, null, 2));

      const { error: passengerError } = await supabase
        .from('passengers')
        .insert(passengerInserts);
        
      if (passengerError) {
        console.error('Passenger insertion error:', passengerError);
        throw passengerError;
      }

      console.log('Passengers added successfully');
    } catch (passengerError) {
      console.error('Passenger insertion failed:', passengerError);
      // Clean up booking if passenger insertion fails
      await supabase.from('bookings').delete().eq('id', booking.id);
      throw new Error(`Failed to add passengers: ${passengerError.message}`);
    }

    // Add seat selections if provided
    if (seatSelections && seatSelections.length > 0) {
      try {
        const seatInserts = seatSelections.map(seat => ({
          booking_id: booking.id,
          ...seat,
          created_at: new Date().toISOString()
        }));
        
        const { error: seatError } = await supabase
          .from('seat_selections')
          .insert(seatInserts);
          
        if (seatError) throw seatError;
        console.log('Seat selections added successfully');
      } catch (seatError) {
        console.warn('Seat selection insertion failed:', seatError.message);
        // Continue without seat selections
      }
    }

    // Add baggage selections if provided
    if (baggageSelections && baggageSelections.length > 0) {
      try {
        const baggageInserts = baggageSelections.map(baggage => ({
          booking_id: booking.id,
          ...baggage,
          created_at: new Date().toISOString()
        }));
        
        const { error: baggageError } = await supabase
          .from('baggage_selections')
          .insert(baggageInserts);
          
        if (baggageError) throw baggageError;
        console.log('Baggage selections added successfully');
      } catch (baggageError) {
        console.warn('Baggage selection insertion failed:', baggageError.message);
        // Continue without baggage selections
      }
    }

    console.log('=== BOOKING CREATION COMPLETE ===');
    
    return { 
      booking, 
      bookingReference,
      success: true,
      bookingId: booking.id
    };
    
  } catch (error) {
    console.error('=== BOOKING CREATION ERROR ===');
    console.error('Error details:', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

  generateBookingReference() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substr(2, 5).toUpperCase();
    return `BK${timestamp}${random}`;
  }



    async applyPromoCode(code, amount) {
    try {
      const { data: promo, error } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('code', code)
        .eq('is_active', true)
        .single();

      if (error || !promo) {
        throw new Error('Invalid promo code');
      }

      if (new Date(promo.expires_at) < new Date()) {
        throw new Error('Promo code has expired');
      }

      if (promo.discount_type === 'percentage') {
        return amount * (promo.discount_value / 100);
      } else {
        return Math.min(promo.discount_value, amount);
      }
    } catch (error) {
      throw new Error(`Promo code error: ${error.message}`);
    }
  }

  // New confirm booking method
  async confirmBooking(bookingId, userId, paymentData, status = 'confirmed') {
    try {
      // First, verify the booking exists and belongs to the user
      const { data: existingBooking, error: fetchError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !existingBooking) {
        throw new Error('Booking not found or access denied');
      }

      // Check if booking is in a valid state for confirmation
      if (existingBooking.status !== 'pending_payment') {
        throw new Error(`Cannot confirm booking with status: ${existingBooking.status}`);
      }

      // Update booking status and add payment confirmation timestamp
      const { data: updatedBooking, error: updateError } = await supabase
        .from('bookings')
        .update({
          status: status,
          confirmed_at: new Date().toISOString(),
          payment_confirmed: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId)
        .eq('user_id', userId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to update booking: ${updateError.message}`);
      }

      // Store payment information if provided
      if (paymentData) {
        await this.storePaymentRecord(bookingId, paymentData, existingBooking.total_amount);
      }

      // Send confirmation email (you can implement this separately)
      await this.sendConfirmationEmail(updatedBooking);

      // Update partner commission if applicable
      if (existingBooking.partner_id && existingBooking.commission_earned > 0) {
        await this.updatePartnerCommission(existingBooking.partner_id, existingBooking.commission_earned);
      }

      return {
        message: 'Booking confirmed successfully',
        booking: updatedBooking,
        bookingReference: updatedBooking.booking_reference
      };

    } catch (error) {
      console.error('Error confirming booking:', error);
      throw error;
    }
  }

  // Helper method to store payment record
  async storePaymentRecord(bookingId, paymentData, amount) {
    try {
      const { error } = await supabase
        .from('payments')
        .insert({
          booking_id: bookingId,
          payment_method: paymentData.paymentMethod || 'unknown',
          transaction_id: paymentData.transactionId || paymentData.id,
          amount: amount,
          currency: paymentData.currency || 'NGN',
          status: 'completed',
          payment_gateway: paymentData.gateway || 'paystack',
          payment_data: paymentData,
          processed_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error storing payment record:', error);
        // Don't throw here as booking confirmation is more important
      }
    } catch (error) {
      console.error('Error in storePaymentRecord:', error);
    }
  }

  // Helper method to send confirmation email
  async sendConfirmationEmail(booking) {
    try {
      // Implementation depends on your email service
      // You can use SendGrid, Nodemailer, or any other email service
      console.log(`Sending confirmation email for booking ${booking.booking_reference}`);
      
      // Example: You might call an email service here
      await emailService.sendBookingConfirmation(booking);
      
    } catch (error) {
      console.error('Error sending confirmation email:', error);
      // Don't throw here as it shouldn't fail the booking confirmation
    }
  }

  // Helper method to update partner commission
  async updatePartnerCommission(partnerId, commissionAmount, bookingId) {
  try {
    console.log(`Updating partner ${partnerId} commission: ${commissionAmount}`);
    
    // Get current partner data
    const { data: partner, error: fetchError } = await supabase
      .from('partners')
      .select('available_balance, total_earnings')
      .eq('id', partnerId)
      .single();

    if (fetchError) {
      console.error('Error fetching partner data:', fetchError);
      return;
    }

    const newAvailableBalance = (partner.available_balance || 0) + commissionAmount;
    const newTotalEarnings = (partner.total_earnings || 0) + commissionAmount;

    // Update partner balance and earnings
    const { error: updateError } = await supabase
      .from('partners')
      .update({
        available_balance: newAvailableBalance,
        total_earnings: newTotalEarnings,
        updated_at: new Date().toISOString()
      })
      .eq('id', partnerId);

    if (updateError) {
      console.error('Error updating partner commission:', updateError);
      return;
    }

    // Create commission record for tracking
    const { error: commissionError } = await supabase
      .from('partner_commissions')
      .insert({
        partner_id: partnerId,
        booking_id: bookingId,
        commission_amount: commissionAmount,
        status: 'earned',
        earned_at: new Date().toISOString()
      });

    if (commissionError) {
      console.error('Error creating commission record:', commissionError);
      // Don't throw error here as the main update succeeded
    }

    console.log(`Partner commission updated successfully. New balance: ${newAvailableBalance}`);
    
  } catch (error) {
    console.error('Error in updatePartnerCommission:', error);
  }
}

  async getUserBookings(userId) {
    try {
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select(`
          *,
          passengers(*),
          seat_selections(*),
          baggage_selections(*)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return bookings;
    } catch (error) {
      throw error;
    }
  }

  async getBookingDetails(bookingId, userId, partnerId = null) {
    try {
      let query = supabase
        .from('bookings')
        .select(`
          *,
          passengers(*),
          seat_selections(*),
          baggage_selections(*),
          payments(*)
        `)
        .eq('id', bookingId);

      if (userId) {
        query = query.eq('user_id', userId);
      } else if (partnerId) {
        query = query.eq('partner_id', partnerId);
      }

      const { data: booking, error } = await query.single();

      if (error) throw error;

      return booking;
    } catch (error) {
      throw error;
    }
  }

  async cancelBooking(bookingId, userId, reason) {
  try {
    console.log(`Starting cancellation for booking ${bookingId}`);

    // Fetch the booking with all related data
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select(`
        *,
        passengers(*),
        payments(*)
      `)
      .eq('id', bookingId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !booking) {
      throw new Error('Booking not found or access denied');
    }

    if (booking.status === 'cancelled') {
      throw new Error('Booking is already cancelled');
    }

    // Check if booking can be cancelled
    if (booking.status === 'completed') {
      throw new Error('Cannot cancel completed bookings');
    }

    // Calculate refund amount (you can customize this logic)
    let refundAmount = 0;
    if (booking.status === 'confirmed') {
      // Apply cancellation policy - for now, 50% refund for confirmed bookings
      refundAmount = booking.total_amount * 0.5; 
    }

    // Update booking status
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancellation_reason: reason,
        cancelled_at: new Date().toISOString(),
        refund_amount: refundAmount,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to cancel booking: ${updateError.message}`);
    }

    // Process refund if applicable
    if (refundAmount > 0) {
      await this.processRefund(userId, refundAmount, bookingId);
    }

    // Send cancellation email
    try {
      await this.sendCancellationEmail(updatedBooking);
    } catch (emailError) {
      console.warn('Failed to send cancellation email:', emailError);
    }

    console.log(`Booking ${bookingId} cancelled successfully`);

    return { 
      message: 'Booking cancelled successfully',
      refundAmount: refundAmount,
      booking: updatedBooking
    };

  } catch (error) {
    console.error('Error cancelling booking:', error);
    throw error;
  }
}

async generateTicket(booking) {
  try {
    console.log(`Generating ticket for booking ${booking.id}`);

    // Create a new PDF document
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    // Collect PDF data
    doc.on('data', (chunk) => chunks.push(chunk));
    
    return new Promise((resolve, reject) => {
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });

      doc.on('error', reject);

      // Add content to PDF
      this.addTicketContent(doc, booking);
      
      // Finalize the PDF
      doc.end();
    });

  } catch (error) {
    console.error('Error generating ticket:', error);
    throw new Error(`Failed to generate ticket: ${error.message}`);
  }
}

addTicketContent(doc, booking) {
  // Add header
  doc.fontSize(20)
     .font('Helvetica-Bold')
     .text('FLIGHT TICKET', 50, 50, { align: 'center' });

  doc.fontSize(14)
     .font('Helvetica')
     .text(`Booking Reference: ${booking.booking_reference}`, 50, 100)
     .text(`Status: ${booking.status.toUpperCase()}`, 50, 120);

  // Add flight information
  doc.fontSize(16)
     .font('Helvetica-Bold')
     .text('Flight Information', 50, 160);

  let yPosition = 180;

  // Extract flight details
  const flightOffer = booking.flight_offer;
  const itinerary = flightOffer.itineraries?.[0];
  const segment = itinerary?.segments?.[0];

  if (segment) {
    doc.fontSize(12)
       .font('Helvetica')
       .text(`Route: ${segment.departure?.iataCode || 'N/A'} → ${segment.arrival?.iataCode || 'N/A'}`, 50, yPosition);
    
    yPosition += 20;
    doc.text(`Flight: ${segment.carrierCode || ''} ${segment.number || ''}`, 50, yPosition);
    
    yPosition += 20;
    doc.text(`Departure: ${segment.departure?.at || 'N/A'}`, 50, yPosition);
    
    yPosition += 20;
    doc.text(`Arrival: ${segment.arrival?.at || 'N/A'}`, 50, yPosition);
  }

  // Add passenger information
  yPosition += 40;
  doc.fontSize(16)
     .font('Helvetica-Bold')
     .text('Passenger Information', 50, yPosition);

  yPosition += 20;
  if (booking.passengers && booking.passengers.length > 0) {
    booking.passengers.forEach((passenger, index) => {
      yPosition += 20;
      doc.fontSize(12)
         .font('Helvetica')
         .text(`${index + 1}. ${passenger.first_name} ${passenger.last_name}`, 50, yPosition);
    });
  }

  // Add contact information
  yPosition += 40;
  doc.fontSize(16)
     .font('Helvetica-Bold')
     .text('Contact Information', 50, yPosition);

  yPosition += 20;
  doc.fontSize(12)
     .font('Helvetica')
     .text(`Email: ${booking.contact_info?.email || 'N/A'}`, 50, yPosition);

  yPosition += 20;
  doc.text(`Phone: ${booking.contact_info?.phone || 'N/A'}`, 50, yPosition);

  // Add payment information
  yPosition += 40;
  doc.fontSize(16)
     .font('Helvetica-Bold')
     .text('Payment Information', 50, yPosition);

  yPosition += 20;
  doc.fontSize(12)
     .font('Helvetica')
     .text(`Total Amount: ${flightOffer.price?.currency || 'NGN'} ${booking.total_amount.toFixed(2)}`, 50, yPosition);

  // Add footer
  yPosition += 60;
  doc.fontSize(10)
     .font('Helvetica')
     .text('Thank you for choosing our service!', 50, yPosition, { align: 'center' })
     .text(`Generated on: ${new Date().toLocaleString()}`, 50, yPosition + 20, { align: 'center' });

  // Add a simple border
  doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).stroke();
}

async processRefund(userId, amount, bookingId) {
  try {
    console.log(`Processing refund of ${amount} for user ${userId}`);

    // Create refund record
    const { error: refundError } = await supabase
      .from('refunds')
      .insert({
        booking_id: bookingId,
        user_id: userId,
        amount: amount,
        status: 'pending',
        created_at: new Date().toISOString()
      });

    if (refundError) {
      console.error('Error creating refund record:', refundError);
    }

    // You can add wallet credit or process actual refund here
    // For now, we'll just log the refund
    console.log(`Refund of ${amount} processed for booking ${bookingId}`);

  } catch (error) {
    console.error('Error processing refund:', error);
    throw error;
  }
}

async sendCancellationEmail(booking) {
  try {
    console.log(`Sending cancellation email for booking ${booking.booking_reference}`);
    
    // Implementation depends on your email service
    // This is a placeholder - you'll need to implement actual email sending
    if (emailService && typeof emailService.sendCancellationEmail === 'function') {
      await emailService.sendCancellationEmail(booking);
    }
    
  } catch (error) {
    console.error('Error sending cancellation email:', error);
    // Don't throw here as it shouldn't fail the cancellation
  }
}
  generateBookingReference() {
    const prefix = 'ELV';
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  async applyPromoCode(promoCode, amount) {
    const { data: promo, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', promoCode)
      .eq('status', 'active')
      .single();

    if (error || !promo) {
      throw new Error('Invalid promo code');
    }

    if (new Date(promo.expiry_date) < new Date()) {
      throw new Error('Promo code expired');
    }

    if (promo.usage_count >= promo.usage_limit) {
      throw new Error('Promo code usage limit reached');
    }

    let discount = 0;
    if (promo.discount_type === 'percentage') {
      discount = (amount * promo.discount_value) / 100;
      if (promo.max_discount && discount > promo.max_discount) {
        discount = promo.max_discount;
      }
    } else {
      discount = promo.discount_value;
    }

    // Update usage count
    await supabase
      .from('promo_codes')
      .update({ usage_count: promo.usage_count + 1 })
      .eq('id', promo.id);

    return discount;
  }

  calculateRefund(booking, cancellationPolicy) {
    if (!cancellationPolicy.refundable) {
      return 0;
    }

    const totalAmount = booking.total_amount;
    const penaltyAmount = cancellationPolicy.penaltyAmount || 0;
    
    return Math.max(0, totalAmount - penaltyAmount);
  }

  async processRefund(userId, amount, bookingId) {
    // Add to user wallet
    await supabase.rpc('add_to_wallet', {
      user_id: userId,
      amount: amount
    });

    // Create refund record
    await supabase
      .from('refunds')
      .insert({
        booking_id: bookingId,
        user_id: userId,
        amount: amount,
        status: 'completed',
        processed_at: new Date().toISOString()
      });
  }
}

module.exports = BookingService;