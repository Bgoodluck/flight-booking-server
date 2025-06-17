const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/emailService');
const axios = require('axios');
const PartnerService = require('./partnerService');



const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class PaymentService {
  partnerService = new PartnerService();
  constructor() {
    this.flutterwaveSecretKey = process.env.FLUTTERWAVE_SECRET_KEY;
    // this.flutterwavePublicKey = process.env.FLUTTERWAVE_PUBLIC_KEY;
    this.flutterwaveBaseUrl = process.env.FLUTTERWAVE_BASE_URL;
    this.currency = 'NGN';
    this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  }

  

  async processPayment(paymentData) {
    try {
      const { bookingId, paymentMethod, amount, userId } = paymentData;

      // Validate required fields
      if (!bookingId || !paymentMethod || !amount || !userId) {
        throw new Error('Missing required payment data');
      }

      // Get booking details
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (bookingError || !booking) {
        throw new Error('Booking not found');
      }

      // Check if booking belongs to user
      if (booking.user_id !== userId) {
        throw new Error('Unauthorized access to booking');
      }

      let paymentResult;

      switch (paymentMethod.type) {
        case 'wallet':
          paymentResult = await this.processWalletPayment(userId, amount);
          break;
        case 'card':
        case 'bank_transfer':
        case 'ussd':
        case 'mobile_money':
          paymentResult = await this.processFlutterwavePayment(paymentMethod, amount, userId, bookingId);
          break;
        case 'cash':
          paymentResult = await this.processCashPayment(userId, amount, bookingId);
          break;
        default:
          throw new Error('Unsupported payment method');
      }

      // Create payment record - Fixed to match schema
      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .insert({
          booking_id: bookingId,
          user_id: userId,
          amount: parseFloat(amount),
          currency: this.currency,
          payment_method: paymentMethod.type,
          payment_method_id: paymentMethod.id || null,
          transaction_id: paymentResult.transactionId,
          status: paymentResult.status,
          processed_at: paymentResult.status === 'completed' ? new Date().toISOString() : null,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (paymentError) {
        console.error('Payment record creation error:', paymentError);
        throw new Error('Failed to create payment record');
      }

      // Update booking status if payment successful
      if (paymentResult.status === 'completed') {
        await this.updateBookingAfterPayment(booking);
      }

      return {
  success: true,
  message: "Payment processed successfully",
  status: paymentResult.status,
  // ADD THESE TOP-LEVEL PROPERTIES FOR EASIER ACCESS
  paymentLink: paymentResult.paymentResult?.paymentLink || paymentResult.gatewayResponse?.data?.link,
  transactionId: paymentResult.transactionId,
  nextAction: paymentResult.nextAction,
  // Keep existing nested structure for backward compatibility
  data: {
    payment,
    paymentResult,
    booking: {
      id: booking.id,
      booking_reference: booking.booking_reference,
      status: paymentResult.status === 'completed' ? 'confirmed' : booking.status
    }
  }
};
    } catch (error) {
      console.error('Payment processing error:', error);
      throw error;
    }
  }

  async processWalletPayment(userId, amount) {
    try {
      // Check wallet balance - using the wallet_balance from users table as per schema
      const { data: user, error } = await supabase
        .from('users')
        .select('wallet_balance')
        .eq('id', userId)
        .single();

      if (error || !user) {
        throw new Error('User not found');
      }

      const walletBalance = parseFloat(user.wallet_balance) || 0;
      const paymentAmount = parseFloat(amount);

      if (walletBalance < paymentAmount) {
        throw new Error(`Insufficient wallet balance. Available: ₦${walletBalance.toLocaleString()}, Required: ₦${paymentAmount.toLocaleString()}`);
      }

      // Update wallet balance directly in users table
      const newBalance = walletBalance - paymentAmount;
      const { error: updateError } = await supabase
        .from('users')
        .update({ wallet_balance: newBalance })
        .eq('id', userId);

      if (updateError) {
        console.error('Wallet balance update error:', updateError);
        throw new Error('Failed to update wallet balance');
      }

      const transactionId = `wallet_${Date.now()}`;

      // Create wallet transaction record
      await supabase
        .from('wallet_transactions')
        .insert({
          user_id: userId,
          type: 'debit',
          amount: paymentAmount,
          description: 'Flight booking payment',
          transaction_id: transactionId,
          status: 'completed',
          created_at: new Date().toISOString()
        });

      return {
        status: 'completed',
        transactionId: transactionId,
        gatewayResponse: { 
          message: 'Wallet payment successful',
          previousBalance: walletBalance,
          newBalance: newBalance
        }
      };
    } catch (error) {
      console.error('Wallet payment error:', error);
      throw error;
    }
  }

  async processFlutterwavePayment(paymentMethod, amount, userId, bookingId) {
    try {
      // Get user details for the payment
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('email, first_name, last_name, phone')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        throw new Error('User not found');
      }

      const transactionRef = `booking_${bookingId}_${Date.now()}`;
      const paymentAmount = parseFloat(amount);

      const payload = {
        tx_ref: transactionRef,
        amount: paymentAmount,
        currency: this.currency, // NGN
        redirect_url: `${this.frontendUrl}/payment/callback`,
        payment_options: this.getPaymentOptions(paymentMethod.type),
        customer: {
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
          phonenumber: user.phone || paymentMethod.phoneNumber || ''
        },
        customizations: {
          title: 'Flight Booking Payment',
          description: `Payment for booking #${bookingId}`,
          logo: `${this.frontendUrl}/assets/logo.png`
        },
        meta: {
          booking_id: bookingId,
          user_id: userId,
          payment_type: 'booking'
        }
      };

      // Add specific configurations for different payment methods
      if (paymentMethod.type === 'mobile_money' && paymentMethod.network) {
        payload.payment_options = 'mobilemoneyghana,mobilemoneyuganda,mobilemoneyrwanda,mobilemoneykenya,mobilemoneyzambia,mobilemoneytanzania';
      }

      if (paymentMethod.type === 'ussd') {
        payload.payment_options = 'ussd';
      }

      console.log('Flutterwave payload:', JSON.stringify(payload, null, 2));

      const response = await axios.post(
        `${this.flutterwaveBaseUrl}/payments`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.flutterwaveSecretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      console.log('Flutterwave response:', response.data);

      if (response.data.status === 'success') {
        return {
          status: 'pending',
          transactionId: transactionRef,
          gatewayResponse: response.data,
          paymentResult: {
            paymentLink: response.data.data.link,
            status: 'pending'
          },
          nextAction: {
            type: 'redirect',
            url: response.data.data.link,
            message: 'Redirecting to Flutterwave payment gateway'
          }
        };
      } else {
        console.error('Flutterwave initialization failed:', response.data);
        throw new Error(response.data.message || 'Payment initialization failed');
      }
    } catch (error) {
      console.error('Flutterwave payment error:', error);
      if (error.response) {
        console.error('Flutterwave API response:', error.response.data);
        throw new Error(`Payment gateway error: ${error.response.data.message || error.message}`);
      }
      throw new Error(`Payment initialization failed: ${error.message}`);
    }
  }

  getPaymentOptions(paymentType) {
    const paymentOptionsMap = {
      'card': 'card',
      'bank_transfer': 'banktransfer',
      'ussd': 'ussd',
      'mobile_money': 'mobilemoneyghana,mobilemoneyuganda,mobilemoneyrwanda,mobilemoneykenya,mobilemoneyzambia,mobilemoneytanzania',
      'default': 'card,banktransfer,ussd'
    };
    
    return paymentOptionsMap[paymentType] || paymentOptionsMap.default;
  }

  async processCashPayment(userId, amount, bookingId) {
    try {
      return {
        status: 'pending',
        transactionId: `cash_${bookingId}_${Date.now()}`,
        gatewayResponse: { 
          message: 'Cash payment option selected. Please visit our office to complete payment.',
          amount: parseFloat(amount),
          currency: this.currency
        }
      };
    } catch (error) {
      console.error('Cash payment error:', error);
      throw error;
    }
  }


async verifyPayment(transactionId) {
  try {
    if (!transactionId) {
      throw new Error('Transaction ID is required');
    }

    console.log('🔍 Verifying payment for transaction:', transactionId);

    // For wallet payments, check the transaction record
    if (transactionId.startsWith('wallet_')) {
      return await this.verifyWalletPayment(transactionId);
    }

    // For cash payments, check the payment record
    if (transactionId.startsWith('cash_')) {
      return await this.verifyCashPayment(transactionId);
    }

    // For Flutterwave payments - first check if we have this transaction in our database
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('transaction_id', transactionId)
      .maybeSingle(); // Use maybeSingle to avoid "no rows" error

    if (paymentError) {
      console.error('Database error:', paymentError);
      throw new Error('Failed to fetch payment record');
    }

    // If payment is already confirmed in our database, return success
    if (paymentRecord && paymentRecord.status === 'completed') {
      console.log('✅ Payment already confirmed in database');
      return {
        verified: true,
        status: 'successful',
        successful: true,
        amount: parseFloat(paymentRecord.amount),
        currency: paymentRecord.currency || 'NGN',
        reference: paymentRecord.transaction_id,
        data: paymentRecord,
        payment: paymentRecord
      };
    }

    // If we have a payment record, try to get the Flutterwave transaction ID
    let flutterwaveTransactionId = transactionId;
    
    if (paymentRecord && paymentRecord.flutterwave_transaction_id) {
      flutterwaveTransactionId = paymentRecord.flutterwave_transaction_id;
      console.log('🔄 Using Flutterwave transaction ID:', flutterwaveTransactionId);
    } else if (transactionId.startsWith('booking_')) {
      // If we don't have the Flutterwave ID stored, try using tx_ref for verification
      try {
        console.log('🔄 Attempting verification with tx_ref');
        const response = await axios.get(
          `${this.flutterwaveBaseUrl}/transactions/verify_by_reference?tx_ref=${transactionId}`,
          {
            headers: {
              'Authorization': `Bearer ${this.flutterwaveSecretKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );

        if (response.data.status === 'success') {
          const transactionData = response.data.data;
          return await this.processVerificationResponse(transactionData, transactionId);
        }
      } catch (refError) {
        console.log('❌ tx_ref verification failed, trying direct ID verification');
      }
    }

    // Try direct transaction ID verification
    try {
      const response = await axios.get(
        `${this.flutterwaveBaseUrl}/transactions/${flutterwaveTransactionId}/verify`,
        {
          headers: {
            'Authorization': `Bearer ${this.flutterwaveSecretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data.status === 'success') {
        const transactionData = response.data.data;
        return await this.processVerificationResponse(transactionData, transactionId);
      } else {
        console.error('Flutterwave verification failed:', response.data);
        return {
          verified: false,
          status: 'failed',
          successful: false,
          message: response.data.message || 'Payment verification failed'
        };
      }
    } catch (error) {
      console.error('Direct verification failed:', error);
      
      // If both methods fail, check if we got a webhook confirmation
      if (paymentRecord && paymentRecord.webhook_confirmed) {
        console.log('✅ Payment confirmed via webhook, treating as successful');
        
        // Update status to completed
        const { data: updatedPayment } = await supabase
          .from('payments')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString()
          })
          .eq('transaction_id', transactionId)
          .select()
          .maybeSingle();

        await this.handleSuccessfulPayment(transactionId, paymentRecord);

        return {
          verified: true,
          status: 'successful',
          successful: true,
          amount: parseFloat(paymentRecord.amount),
          currency: paymentRecord.currency || 'NGN',
          reference: paymentRecord.transaction_id,
          data: paymentRecord,
          payment: updatedPayment || paymentRecord
        };
      }
      
      throw error;
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    if (error.response) {
      console.error('Flutterwave verification response:', error.response.data);
    }
    throw new Error(`Payment verification failed: ${error.message}`);
  }
}

async processVerificationResponse(transactionData, originalTransactionId) {
  const isSuccessful = transactionData.status === 'successful';
  const amount = parseFloat(transactionData.amount);
  
  // First, check if payment record exists
  const { data: existingPayment, error: fetchError } = await supabase
    .from('payments')
    .select('*')
    .eq('transaction_id', originalTransactionId)
    .maybeSingle(); // Use maybeSingle to avoid error when no rows found

  if (fetchError) {
    console.error('Error fetching payment record:', fetchError);
  }

  // Only update if payment record exists and hasn't been completed yet
  let updatedPayment = existingPayment;
  if (existingPayment && existingPayment.status !== 'completed') {
    const { data: updateResult, error: updateError } = await supabase
      .from('payments')
      .update({
        status: isSuccessful ? 'completed' : 'failed',
        flutterwave_transaction_id: transactionData.id,
        processed_at: new Date().toISOString()
      })
      .eq('transaction_id', originalTransactionId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.error('Payment update error:', updateError);
      // Continue processing even if update fails
    } else {
      updatedPayment = updateResult;
    }
  }

  // Handle successful payment
  if (isSuccessful) {
    try {
      await this.handleSuccessfulPayment(originalTransactionId, transactionData);
    } catch (error) {
      console.error('Error in handleSuccessfulPayment:', error);
      // Don't let post-payment processing failures break verification
    }
  }

  return {
    verified: true,
    status: transactionData.status,
    successful: isSuccessful,
    amount: amount,
    currency: transactionData.currency,
    reference: transactionData.tx_ref,
    data: transactionData,
    payment: updatedPayment || existingPayment
  };
}

  async verifyWalletPayment(transactionId) {
    try {
      const { data: transaction, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('transaction_id', transactionId)
        .single();

      if (error || !transaction) {
        return {
          verified: false,
          status: 'not_found',
          successful: false,
          message: 'Wallet transaction not found'
        };
      }

      return {
        verified: true,
        status: transaction.status,
        successful: transaction.status === 'completed',
        amount: transaction.amount,
        currency: this.currency,
        reference: transactionId,
        data: transaction
      };
    } catch (error) {
      console.error('Wallet verification error:', error);
      throw error;
    }
  }

  async verifyCashPayment(transactionId) {
    try {
      const { data: payment, error } = await supabase
        .from('payments')
        .select('*')
        .eq('transaction_id', transactionId)
        .single();

      if (error || !payment) {
        return {
          verified: false,
          status: 'not_found',
          successful: false,
          message: 'Cash payment record not found'
        };
      }

      return {
        verified: true,
        status: payment.status,
        successful: payment.status === 'completed',
        amount: payment.amount,
        currency: this.currency,
        reference: transactionId,
        data: payment
      };
    } catch (error) {
      console.error('Cash verification error:', error);
      throw error;
    }
  }

 
  async handleSuccessfulPayment(transactionId, transactionData) {
  try {
    // Handle wallet funding
    if (transactionId.includes('wallet_')) {
      const { data: transaction } = await supabase
        .from('wallet_transactions')
        .select('user_id, amount')
        .eq('transaction_id', transactionId)
        .single();

      if (transaction) {
        // Update wallet balance in users table
        const { data: user } = await supabase
          .from('users')
          .select('wallet_balance')
          .eq('id', transaction.user_id)
          .single();

        if (user) {
          const newBalance = (parseFloat(user.wallet_balance) || 0) + parseFloat(transaction.amount);
          await supabase
            .from('users')
            .update({ wallet_balance: newBalance })
            .eq('id', transaction.user_id);
        }

        await supabase
          .from('wallet_transactions')
          .update({ status: 'completed' })
          .eq('transaction_id', transactionId);
      }
      return;
    }

    // Handle booking payment
    if (transactionId.includes('booking_')) {
      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .select('booking_id, user_id')
        .eq('transaction_id', transactionId)
        .single();

      if (paymentError) {
        console.error('Error fetching payment record:', paymentError);
        return;
      }

      if (payment) {
        const { data: booking, error: bookingError } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', payment.booking_id)
          .single();

        if (bookingError) {
          console.error('Error fetching booking record:', bookingError);
          return;
        }

        if (booking) {
          await this.updateBookingAfterPayment(booking);
        }
      }
    }
  } catch (error) {
    console.error('Error handling successful payment:', error);
    // Don't re-throw - this is called during verification and shouldn't break the flow
  }
}


// async updateBookingAfterPayment(booking) {
//   try {
//     // Validate booking data before processing
//     if (!booking) {
//       throw new Error('Booking data is missing');
//     }

//     console.log(`Processing booking update for: ${booking.booking_reference}`);

//     // Update booking status first
//     const { error: bookingUpdateError } = await supabase
//       .from('bookings')
//       .update({
//         status: 'confirmed',
//         updated_at: new Date().toISOString()
//       })
//       .eq('id', booking.id);

//     if (bookingUpdateError) {
//       console.error('Booking update error:', bookingUpdateError);
//       throw bookingUpdateError;
//     }

//     console.log(`✅ Booking ${booking.booking_reference} status updated to confirmed`);

//     // 🔥 UPDATED: Calculate and store commission using user_id as partnerId
//     if (booking.user_id) {
//       try {
//         console.log(`Processing commission for partner ${booking.user_id}`);
        
//         // Calculate and store commission using user_id as the partnerId
//         await this.partnerService.calculateAndStoreCommission(
//           booking.id,           // bookingId
//           booking.user_id,      // partnerId - CHANGED: using user_id instead of partner_id
//           booking.total_price   // totalAmount - using total_price from booking
//         );
        
//         console.log(`✅ Commission calculated for booking ${booking.booking_reference}`);
//       } catch (commissionError) {
//         console.error('Commission calculation error:', commissionError);
//         // Don't throw - booking confirmation is more important than commission
//       }
//     }

//     // Send booking confirmation email
//     try {
//       await this.sendBookingConfirmation(booking);
//     } catch (emailError) {
//       console.error('Error sending booking confirmation email:', emailError);
//       // Don't throw - booking is still successful even if email fails
//     }

//     console.log(`✅ Booking ${booking.booking_reference} fully processed`);

//   } catch (error) {
//     console.error('Error updating booking after payment:', error);
//     throw error;
//   }
// }
async updateBookingAfterPayment(booking) {
  try {
    // Validate booking data before processing
    if (!booking) {
      throw new Error('Booking data is missing');
    }

    console.log(`Processing booking update for: ${booking.booking_reference}`);

    // Update booking status first
    const { error: bookingUpdateError } = await supabase
      .from('bookings')
      .update({
        status: 'confirmed',
        updated_at: new Date().toISOString()
      })
      .eq('id', booking.id);

    if (bookingUpdateError) {
      console.error('Booking update error:', bookingUpdateError);
      throw bookingUpdateError;
    }

    console.log(`✅ Booking ${booking.booking_reference} status updated to confirmed`);

    // 🔥 FIXED: Determine the correct partner ID
    let partnerId = null;
    
    // Method 1: Check if booking has a direct partner_id field
    if (booking.partner_id) {
      partnerId = booking.partner_id;
      console.log(`Using booking.partner_id: ${partnerId}`);
    }
    // Method 2: Check if user_id corresponds to a partner
    else if (booking.user_id) {
      console.log(`Checking if user_id ${booking.user_id} is a partner...`);
      
      const { data: partner, error: partnerCheckError } = await supabase
        .from('partners')
        .select('id, commission_rate')
        .eq('id', booking.user_id)
        .single();
      
      if (!partnerCheckError && partner) {
        partnerId = partner.id;
        console.log(`✅ User ${booking.user_id} is a partner`);
      } else {
        console.log(`❌ User ${booking.user_id} is not a partner or error:`, partnerCheckError);
      }
    }

    // Calculate and store commission if we have a valid partner
    if (partnerId) {
      try {
        console.log(`Processing commission for partner ${partnerId}`);
        
        // Use the booking's total_price or total_amount field
        const bookingAmount = booking.total_price || booking.total_amount || 0;
        
        if (bookingAmount > 0) {
          await this.partnerService.calculateAndStoreCommission(
            booking.id,           // bookingId
            partnerId,            // partnerId - now correctly determined
            bookingAmount         // totalAmount
          );
          
          console.log(`✅ Commission calculated for booking ${booking.booking_reference}`);
        } else {
          console.warn(`⚠️ No valid booking amount found for ${booking.booking_reference}`);
        }
      } catch (commissionError) {
        console.error('Commission calculation error:', commissionError);
        // Don't throw - booking confirmation is more important than commission
      }
    } else {
      console.log(`ℹ️ No partner associated with booking ${booking.booking_reference}`);
    }

    // Send booking confirmation email
    try {
      await this.sendBookingConfirmation(booking);
    } catch (emailError) {
      console.error('Error sending booking confirmation email:', emailError);
      // Don't throw - booking is still successful even if email fails
    }

    console.log(`✅ Booking ${booking.booking_reference} fully processed`);

  } catch (error) {
    console.error('Error updating booking after payment:', error);
    throw error;
  }
}

async processPartnerCommission(booking) {
  try {
    const commissionAmount = parseFloat(booking.commission_earned);
    
    console.log(`Processing commission of ${commissionAmount} for partner ${booking.partner_id}`);

    // Get current partner balance
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('available_balance, total_earnings')
      .eq('id', booking.partner_id)
      .single();

    if (partnerError) {
      console.error('Error fetching partner:', partnerError);
      throw partnerError;
    }

    if (!partner) {
      console.error(`Partner not found: ${booking.partner_id}`);
      return;
    }

    // Calculate new balances
    const currentBalance = parseFloat(partner.available_balance) || 0;
    const currentEarnings = parseFloat(partner.total_earnings) || 0;
    const newBalance = currentBalance + commissionAmount;
    const newEarnings = currentEarnings + commissionAmount;

    // Update partner balances
    const { error: updateError } = await supabase
      .from('partners')
      .update({
        available_balance: newBalance,
        total_earnings: newEarnings,
        updated_at: new Date().toISOString()
      })
      .eq('id', booking.partner_id);

    if (updateError) {
      console.error('Partner balance update error:', updateError);
      throw updateError;
    }

    console.log(`✅ Commission processed: Partner ${booking.partner_id} earned ${commissionAmount}`);
    
    // Optional: Create a commission transaction record for tracking
    try {
      await this.createCommissionRecord(booking, commissionAmount);
    } catch (recordError) {
      console.error('Error creating commission record:', recordError);
      // Don't throw - commission has been processed successfully
    }

  } catch (error) {
    console.error('Error processing partner commission:', error);
    throw error;
  }
}


async createCommissionRecord(booking, commissionAmount) {
  try {
    const { error } = await supabase
      .from('partner_commissions') // Assuming you have this table
      .insert({
        partner_id: booking.partner_id,
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        commission_amount: commissionAmount,
        commission_rate: booking.commission_rate || 0,
        booking_amount: booking.total_price,
        status: 'earned',
        earned_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('Commission record creation error:', error);
    } else {
      console.log(`✅ Commission record created for booking ${booking.booking_reference}`);
    }
  } catch (error) {
    console.error('Error creating commission record:', error);
  }
}

  async updateCashPaymentStatus(paymentId, bookingId) {
    try {
      let payment;

      if (paymentId) {
        // Update by payment ID
        const { data: updatedPayment, error } = await supabase
          .from('payments')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString()
          })
          .eq('id', paymentId)
          .select()
          .single();

        if (error) throw error;
        payment = updatedPayment;
      } else if (bookingId) {
        // Update by booking ID (get latest cash payment)
        const { data: updatedPayment, error } = await supabase
          .from('payments')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString()
          })
          .eq('booking_id', bookingId)
          .eq('payment_method', 'cash')
          .eq('status', 'pending')
          .select()
          .single();

        if (error) throw error;
        payment = updatedPayment;
      } else {
        throw new Error('Either payment ID or booking ID is required');
      }

      // Get booking details and update
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', payment.booking_id)
        .single();

      if (bookingError) {
        console.error('Booking fetch error:', bookingError);
      } else if (booking) {
        await this.updateBookingAfterPayment(booking);
      }

      return { 
        success: true, 
        message: 'Cash payment status updated successfully',
        payment: payment
      };
    } catch (error) {
      console.error('Cash payment update error:', error);
      throw new Error(`Failed to update cash payment status: ${error.message}`);
    }
  }

  
async sendBookingConfirmation(booking) {
  try {
    // Validate email address
    if (!booking.contact_info || !booking.contact_info.email) {
      console.log('No email address found for booking confirmation');
      return;
    }

    console.log(`Preparing booking confirmation for ${booking.booking_reference}`);

    // ✅ Pass the original booking object structure that the template expects
    const emailData = {
      // Keep original property names that the template expects
      booking_reference: booking.booking_reference,
      contact_info: booking.contact_info,
      flight_offer: booking.flight_offer,
      total_amount: booking.total_price,
      passengers: booking.passengers || [{
        first_name: booking.contact_info.firstName || 'Passenger',
        last_name: booking.contact_info.lastName || '',
        passenger_type: 'Adult',
        date_of_birth: 'N/A'
      }],
      seat_selections: booking.seat_selections || [],
      baggage_selections: booking.baggage_selections || [],
      created_at: booking.created_at,
      confirmed_at: booking.confirmed_at || new Date().toISOString(),
      currency: booking.currency || 'NGN'
    };

    // Add warning if flight offer is missing
    if (!booking.flight_offer || !booking.flight_offer.itineraries) {
      console.warn(`⚠️ No flight offer data for booking ${booking.booking_reference} - will use fallback template`);
    }
        
    await sendEmail({
      to: booking.contact_info.email,
      subject: `Booking Confirmation - ${booking.booking_reference}`,
      template: 'booking-confirmation',
      data: emailData // ✅ Now matches the expected structure
    });

    console.log(`✅ Booking confirmation sent for ${booking.booking_reference}`);
  } catch (error) {
    console.error('❌ Error sending booking confirmation:', error);
    // Don't re-throw - this shouldn't break the payment flow
  }
}

  // Wallet-related methods
  async fundWallet(userId, amount, paymentMethod) {
    try {
      // Get user details
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('email, first_name, last_name, phone')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        throw new Error('User not found');
      }

      const transactionRef = `wallet_${userId}_${Date.now()}`;
      const fundingAmount = parseFloat(amount);

      // Process external payment first
      const payload = {
        tx_ref: transactionRef,
        amount: fundingAmount,
        currency: this.currency,
        redirect_url: `${this.frontendUrl}/wallet/callback`,
        customer: {
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
          phonenumber: user.phone || paymentMethod.phoneNumber || ''
        },
        customizations: {
          title: 'Wallet Funding',
          description: `Add ₦${fundingAmount.toLocaleString()} to wallet`,
          logo: `${this.frontendUrl}/assets/logo.png`
        },
        meta: {
          user_id: userId,
          payment_type: 'wallet_funding'
        }
      };

      const response = await axios.post(
        `${this.flutterwaveBaseUrl}/payments`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.flutterwaveSecretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data.status !== 'success') {
        throw new Error(response.data.message || 'Failed to initialize wallet funding');
      }

      // Create wallet transaction record
      const { data: transaction, error: transactionError } = await supabase
        .from('wallet_transactions')
        .insert({
          user_id: userId,
          type: 'credit',
          amount: fundingAmount,
          description: 'Wallet funding via Flutterwave',
          transaction_id: transactionRef,
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (transactionError) {
        console.error('Wallet transaction creation error:', transactionError);
        throw transactionError;
      }

      return { 
        transaction, 
        paymentResult: {
          status: 'pending',
          transactionId: transactionRef,
          paymentLink: response.data.data.link,
          gatewayResponse: response.data,
          amount: fundingAmount,
          currency: this.currency
        }
      };
    } catch (error) {
      console.error('Wallet funding error:', error);
      if (error.response) {
        console.error('Flutterwave funding response:', error.response.data);
      }
      throw error;
    }
  }

  async getWalletBalance(userId) {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('wallet_balance')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Wallet balance fetch error:', error);
        throw error;
      }
      
      return parseFloat(user.wallet_balance) || 0;
    } catch (error) {
      console.error('Get wallet balance error:', error);
      throw error;
    }
  }

  async getWalletTransactions(userId, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      
      const { data: transactions, error, count } = await supabase
        .from('wallet_transactions')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('Wallet transactions fetch error:', error);
        throw error;
      }

      return {
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      console.error('Get wallet transactions error:', error);
      throw error;
    }
  }
}

module.exports = PaymentService;