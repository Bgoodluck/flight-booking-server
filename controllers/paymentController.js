const PaymentService = require('../services/paymentService');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const paymentService = new PaymentService();

class PaymentController {
  // Process payment (card, wallet, mobile money, bank transfer, cash)
  async processPayment(req, res) {
  try {
    console.log('Payment request received:', {
      body: req.body,
      userId: req.user?.id,
      timestamp: new Date().toISOString()
    });
    
    const { bookingId, paymentMethod, amount } = req.body;
    
    // Validate required fields
    if (!bookingId) {
      return res.status(400).json({ 
        success: false,
        error: 'Booking ID is required',
        code: 'MISSING_BOOKING_ID'
      });
    }
    
    if (!paymentMethod || !paymentMethod.type) {
      return res.status(400).json({ 
        success: false,
        error: 'Payment method and type are required',
        code: 'MISSING_PAYMENT_METHOD'
      });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Valid amount is required',
        code: 'INVALID_AMOUNT'
      });
    }
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED'
      });
    }

    // Validate payment method type
    const validPaymentMethods = ['wallet', 'card', 'bank_transfer', 'ussd', 'mobile_money', 'cash'];
    if (!validPaymentMethods.includes(paymentMethod.type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid payment method. Supported methods: ${validPaymentMethods.join(', ')}`,
        code: 'INVALID_PAYMENT_METHOD'
      });
    }
    
    const result = await paymentService.processPayment({
      bookingId,
      paymentMethod,
      userId: req.user.id,
      amount: parseFloat(amount)
    });
    
    // FIXED: Access the correct properties from the result
    // result.status is the payment status, result.paymentLink is the payment link
    if (result.status === 'pending' && (result.paymentLink || result.data?.paymentLink)) {
  const paymentLink = result.paymentLink || result.data?.paymentLink || 
                     result.data?.data?.paymentResult?.paymentResult?.paymentLink;
  
  return res.json({
    success: true,
    message: 'Payment link generated successfully',
    status: 'pending',
    requiresAction: true,
    paymentLink: paymentLink, // Add this top-level property
    data: {
      ...result,
      nextAction: {
        type: 'redirect',
        url: paymentLink,
        message: 'Please complete payment on the redirected page'
      }
    }
  });
}
    
    res.json({
      success: true,
      message: result.status === 'completed' ? 'Payment completed successfully' : 'Payment processed successfully',
      status: result.status,
      data: result
    });
    
  } catch (error) {
    console.error('Payment processing error:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      body: req.body,
      timestamp: new Date().toISOString()
    });
    
    res.status(400).json({ 
      success: false,
      error: error.message,
      code: 'PAYMENT_PROCESSING_ERROR'
    });
  }
}

  // Update cash payment status (for admin/staff)
  async updateCashPaymentStatus(req, res) {
    try {
      const { paymentId, bookingId } = req.body;
      
      if (!paymentId && !bookingId) {
        return res.status(400).json({ 
          success: false,
          error: 'Payment ID or Booking ID is required',
          code: 'MISSING_IDENTIFIER'
        });
      }

      // Check if user has admin privileges
      if (!req.user.role || !['admin', 'super_admin', 'staff'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions to update cash payment status',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }
      
      const result = await paymentService.updateCashPaymentStatus(paymentId, bookingId);
      
      res.json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      console.error('Cash payment update error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'CASH_PAYMENT_UPDATE_ERROR'
      });
    }
  }

  // Fund wallet
  async fundWallet(req, res) {
    try {
      const { amount, paymentMethod } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ 
          success: false,
          error: 'Valid amount is required (must be greater than 0)',
          code: 'INVALID_AMOUNT'
        });
      }

      // Set minimum funding amount
      const minAmount = 100; // ₦100 minimum
      if (parseFloat(amount) < minAmount) {
        return res.status(400).json({
          success: false,
          error: `Minimum funding amount is ₦${minAmount}`,
          code: 'AMOUNT_TOO_LOW'
        });
      }
      
      if (!paymentMethod || !paymentMethod.type) {
        return res.status(400).json({ 
          success: false,
          error: 'Payment method and type are required',
          code: 'MISSING_PAYMENT_METHOD'
        });
      }

      // Validate payment method for wallet funding (cash not allowed for wallet funding)
      const validWalletMethods = ['card', 'bank_transfer', 'ussd', 'mobile_money'];
      if (!validWalletMethods.includes(paymentMethod.type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid payment method for wallet funding. Supported methods: ${validWalletMethods.join(', ')}`,
          code: 'INVALID_WALLET_PAYMENT_METHOD'
        });
      }
      
      const result = await paymentService.fundWallet(req.user.id, amount, paymentMethod);
      
      res.json({
        success: true,
        message: 'Wallet funding initiated successfully',
        data: {
          transaction: result.transaction,
          paymentLink: result.paymentResult.paymentLink,
          amount: result.paymentResult.amount,
          transactionId: result.paymentResult.transactionId,
          nextAction: {
            type: 'redirect',
            url: result.paymentResult.paymentLink,
            message: 'Please complete payment to fund your wallet'
          }
        }
      });
    } catch (error) {
      console.error('Wallet funding error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'WALLET_FUNDING_ERROR'
      });
    }
  }

  // Get wallet balance
  async getWalletBalance(req, res) {
    try {
      const balance = await paymentService.getWalletBalance(req.user.id);
      res.json({ 
        success: true,
        data: {
          balance: balance,
          formattedBalance: `₦${balance.toLocaleString()}`,
          currency: 'NGN'
        }
      });
    } catch (error) {
      console.error('Get wallet balance error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'WALLET_BALANCE_ERROR'
      });
    }
  }

  // Get wallet transactions
  async getWalletTransactions(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const transactions = await paymentService.getWalletTransactions(req.user.id, page, limit);
      res.json({
        success: true,
        data: transactions
      });
    } catch (error) {
      console.error('Get wallet transactions error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'WALLET_TRANSACTIONS_ERROR'
      });
    }
  }

  // Withdraw from wallet
  async withdrawFromWallet(req, res) {
    try {
      const { amount, bankDetails } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ 
          success: false,
          error: 'Valid amount is required',
          code: 'INVALID_AMOUNT'
        });
      }

      // Set minimum withdrawal amount
      const minAmount = 500; // ₦500 minimum
      if (parseFloat(amount) < minAmount) {
        return res.status(400).json({
          success: false,
          error: `Minimum withdrawal amount is ₦${minAmount}`,
          code: 'AMOUNT_TOO_LOW'
        });
      }
      
      if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode || !bankDetails.accountName) {
        return res.status(400).json({ 
          success: false,
          error: 'Complete bank details are required (accountNumber, bankCode, accountName)',
          code: 'MISSING_BANK_DETAILS'
        });
      }

      // Check wallet balance first
      const balance = await paymentService.getWalletBalance(req.user.id);
      if (balance < parseFloat(amount)) {
        return res.status(400).json({
          success: false,
          error: `Insufficient wallet balance. Available: ₦${balance.toLocaleString()}, Requested: ₦${parseFloat(amount).toLocaleString()}`,
          code: 'INSUFFICIENT_BALANCE'
        });
      }
      
      // Create withdrawal request (implement this method in your service)
      const withdrawalData = {
        userId: req.user.id,
        amount: parseFloat(amount),
        bankDetails: bankDetails,
        status: 'pending',
        requestedAt: new Date().toISOString()
      };

      // Insert withdrawal request
      const { data: withdrawal, error } = await supabase
        .from('wallet_withdrawals')
        .insert(withdrawalData)
        .select()
        .single();

      if (error) {
        console.error('Withdrawal request error:', error);
        throw new Error('Failed to create withdrawal request');
      }

      res.json({
        success: true,
        message: 'Withdrawal request submitted successfully. It will be processed within 24 hours.',
        data: {
          withdrawalId: withdrawal.id,
          amount: withdrawal.amount,
          status: withdrawal.status,
          requestedAt: withdrawal.created_at
        }
      });
    } catch (error) {
      console.error('Withdraw from wallet error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'WALLET_WITHDRAWAL_ERROR'
      });
    }
  }

  // Verify payment
  async verifyPayment(req, res) {
    try {
      const { transactionId } = req.params;
      
      if (!transactionId) {
        return res.status(400).json({ 
          success: false,
          error: 'Transaction ID is required',
          code: 'MISSING_TRANSACTION_ID'
        });
      }
      
      const result = await paymentService.verifyPayment(transactionId);
      res.json({
        success: true,
        message: 'Payment verification completed',
        data: result
      });
    } catch (error) {
      console.error('Payment verification error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'PAYMENT_VERIFICATION_ERROR'
      });
    }
  }

  // Get payment history
  async getPaymentHistory(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const offset = (page - 1) * limit;
      
      let query = supabase
        .from('payments')
        .select(`
          *,
          bookings:booking_id (
            booking_reference,
            flight_offer
          )
        `, { count: 'exact' })
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      
      if (status) {
        query = query.eq('status', status);
      }
      
      const { data: payments, error, count } = await query;
      
      if (error) {
        console.error('Payment history fetch error:', error);
        throw error;
      }
      
      res.json({
        success: true,
        data: {
          payments,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit)
          }
        }
      });
    } catch (error) {
      console.error('Get payment history error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'PAYMENT_HISTORY_ERROR'
      });
    }
  }

  // Get all payments for a specific booking
  async getBookingPayments(req, res) {
    try {
      const { bookingId } = req.params;
      
      if (!bookingId) {
        return res.status(400).json({
          success: false,
          error: 'Booking ID is required',
          code: 'MISSING_BOOKING_ID'
        });
      }
      
      // Verify user owns the booking or is admin
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('user_id')
        .eq('id', bookingId)
        .single();
      
      if (bookingError || !booking) {
        return res.status(404).json({
          success: false,
          error: 'Booking not found',
          code: 'BOOKING_NOT_FOUND'
        });
      }
      
      // Check if user owns the booking or has admin privileges
      const isAdmin = req.user.role && ['admin', 'super_admin', 'staff'].includes(req.user.role);
      if (booking.user_id !== req.user.id && !isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          code: 'ACCESS_DENIED'
        });
      }
      
      const { data: payments, error } = await supabase
        .from('payments')
        .select('*')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Booking payments fetch error:', error);
        throw error;
      }
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      console.error('Get booking payments error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'BOOKING_PAYMENTS_ERROR'
      });
    }
  }

  // Get withdrawal history
  async getWithdrawalHistory(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const offset = (page - 1) * limit;
      
      let query = supabase
        .from('wallet_withdrawals')
        .select('*', { count: 'exact' })
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      
      if (status) {
        query = query.eq('status', status);
      }
      
      const { data: withdrawals, error, count } = await query;
      
      if (error) {
        console.error('Withdrawal history fetch error:', error);
        throw error;
      }
      
      res.json({
        success: true,
        data: {
          withdrawals,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit)
          }
        }
      });
    } catch (error) {
      console.error('Get withdrawal history error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'WITHDRAWAL_HISTORY_ERROR'
      });
    }
  }

  // Handle Flutterwave webhook
  async handleFlutterwaveWebhook(req, res) {
  try {
    const signature = req.headers['verif-hash'];
    const payload = req.body;
    
    // Verify webhook signature
    if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('✅ Flutterwave webhook received:', JSON.stringify(payload, null, 2));

    const { event, data } = payload;

    if (event === 'charge.completed' && data.status === 'successful') {
      const transactionId = data.tx_ref;
      const flutterwaveId = data.id;
      
      console.log(`💰 Payment completed for transaction: ${transactionId}`);
      
      // Update payment record with webhook confirmation
      const { data: updatedPayment, error: updateError } = await supabase
        .from('payments')
        .update({
          status: 'completed',
          flutterwave_transaction_id: flutterwaveId,
          webhook_confirmed: true,
          webhook_received_at: new Date().toISOString(),
          processed_at: new Date().toISOString()
        })
        .eq('transaction_id', transactionId)
        .select()
        .single();

      if (updateError) {
        console.error('Payment update error:', updateError);
      } else {
        console.log('✅ Payment updated successfully via webhook');
        
        // Handle successful payment processing
        await paymentService.handleSuccessfulPayment(transactionId, data);
      }
    }

    res.status(200).json({ status: 'success', message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}
  // Admin: Get all payments with filters
  async getAllPayments(req, res) {
    try {
      // Check admin privileges
      if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      const { 
        page = 1, 
        limit = 20, 
        status, 
        paymentMethod, 
        userId,
        startDate,
        endDate 
      } = req.query;
      
      const offset = (page - 1) * limit;
      
      let query = supabase
        .from('payments')
        .select(`
          *,
          users:user_id (
            first_name,
            last_name,
            email
          ),
          bookings:booking_id (
            booking_reference,
            flight_offer
          )
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      
      // Apply filters
      if (status) query = query.eq('status', status);
      if (paymentMethod) query = query.eq('payment_method', paymentMethod);
      if (userId) query = query.eq('user_id', userId);
      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', endDate);
      
      const { data: payments, error, count } = await query;
      
      if (error) {
        console.error('Admin payments fetch error:', error);
        throw error;
      }
      
      res.json({
        success: true,
        data: {
          payments,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit)
          }
        }
      });
    } catch (error) {
      console.error('Get all payments error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'ADMIN_PAYMENTS_ERROR'
      });
    }
  }

  // Get payment statistics
  async getPaymentStats(req, res) {
    try {
      const { startDate, endDate } = req.query;
      
      let query = supabase
        .from('payments')
        .select('amount, status, payment_method, created_at')
        .eq('user_id', req.user.id);
      
      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', endDate);
      
      const { data: payments, error } = await query;
      
      if (error) {
        console.error('Payment stats fetch error:', error);
        throw error;
      }
      
      // Calculate statistics
      const stats = {
        totalPayments: payments.length,
        totalAmount: payments.reduce((sum, p) => sum + parseFloat(p.amount), 0),
        successfulPayments: payments.filter(p => p.status === 'completed').length,
        pendingPayments: payments.filter(p => p.status === 'pending').length,
        failedPayments: payments.filter(p => p.status === 'failed').length,
        paymentMethods: {}
      };
      
      // Count payment methods
      payments.forEach(payment => {
        const method = payment.payment_method;
        stats.paymentMethods[method] = (stats.paymentMethods[method] || 0) + 1;
      });
      
      // Calculate success rate
      stats.successRate = stats.totalPayments > 0 
        ? ((stats.successfulPayments / stats.totalPayments) * 100).toFixed(2) 
        : 0;
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Get payment stats error:', error);
      res.status(400).json({ 
        success: false,
        error: error.message,
        code: 'PAYMENT_STATS_ERROR'
      });
    }
  }
}

module.exports = PaymentController;