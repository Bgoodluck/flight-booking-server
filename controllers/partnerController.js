const PartnerService = require('../services/partnerService');
const partnerService = new PartnerService();

class PartnerController {
  async register(req, res) {
    try {
      console.log('Partner registration data:', req.body);
      const result = await partnerService.registerPartner(req.body);
      console.log('Registration successful:', result);
      res.status(201).json(result);
    } catch (error) {
      console.error('Partner registration failed:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        details: error
      });
      res.status(400).json({ 
        error: error.message || 'Registration failed',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  async verifyEmail(req, res) {
    try {
      const { email, otp } = req.body;
      console.log('Partner email verification request:', email);
      
      if (!email || !otp) {
        return res.status(400).json({ error: 'Email and OTP are required' });
      }

      const result = await partnerService.verifyEmail(email, otp);
      console.log('Partner email verification successful');
      res.json(result);
    } catch (error) {
      console.error('Partner email verification failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  }

  async resendVerificationEmail(req, res) {
    try {
      const { email } = req.body;
      console.log('Resending verification email for partner:', email);
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const result = await partnerService.resendVerificationEmail(email);
      console.log('Verification email resent successfully');
      res.json(result);
    } catch (error) {
      console.error('Resend verification email failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;
      console.log('Partner login attempt:', email);
      
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const result = await partnerService.loginPartner(email, password);
      console.log('Partner login successful');
      res.json(result);
    } catch (error) {
      console.error('Partner login failed:', error.message);
      res.status(401).json({ error: error.message });
    }
  }

  async getDashboard(req, res) {
  try {
    const partnerId = req.user.id;
    console.log('🔍 Fetching dashboard for partner:', partnerId);
    
    const dashboard = await partnerService.getPartnerDashboard(partnerId);
    
    // Make sure the response structure is consistent
    res.json({
      success: true,
      // Flatten the structure for easier frontend consumption
      totalBookings: dashboard.statistics.totalBookings,
      totalCommission: dashboard.statistics.totalCommissionEarned,
      monthlyBookings: dashboard.statistics.monthlyBookingCount,
      monthlyCommission: dashboard.statistics.monthlyCommission,
      recentBookings: dashboard.recentBookings,
      recentPayouts: dashboard.recentPayouts,
      partner: dashboard.partner,
      statistics: dashboard.statistics,
      message: 'Dashboard data retrieved successfully'
    });
  } catch (error) {
    console.error('Get partner dashboard failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to fetch dashboard data'
    });
  }
}


  async getCommissions(req, res) {
  try {
    const partnerId = req.user.id;
    const { limit = 50 } = req.query;
    
    const commissions = await partnerService.getPartnerCommissions(partnerId, limit);
    
    res.json({
      success: true,
      data: commissions,
      message: 'Commission history retrieved successfully'
    });
  } catch (error) {
    console.error('Get commissions error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch commission history'
    });
  }
}

// Get partner statistics
async getPartnerStats(req, res) {
  try {
    const partnerId = req.user.id;
    
    const stats = await partnerService.getPartnerStats(partnerId);
    
    res.json({
      success: true,
      data: stats,
      message: 'Partner statistics retrieved successfully'
    });
  } catch (error) {
    console.error('Get partner stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch partner statistics'
    });
  }
}


  async requestPayout(req, res) {
  try {
    const { amount } = req.body;
    const partnerId = req.user.id;
    
    // Validation
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Valid amount is required' 
      });
    }

    // Convert string to number
    const payoutAmount = parseFloat(amount);
    
    console.log(`🏦 Payout request: Partner ${partnerId}, Amount: ${payoutAmount}`);
    
    const result = await partnerService.requestPayout(partnerId, payoutAmount);
    
    res.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (error) {
    console.error('Partner payout request failed:', error.message);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
}

  async getBookings(req, res) {
  try {
    const partnerId = req.user.id; 
    console.log('🔍 Partner ID from token:', partnerId);
    const bookings = await partnerService.getPartnerBookings(partnerId);
    
    res.json({
      success: true,
      data: bookings
    });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch bookings'
    });
  }
}

  async getPartnerProfile(req, res) {
    try {
      const partnerId = req.user.id; 
      
      const partnerProfile = await partnerService.getPartnerProfile(partnerId);
      
      res.status(200).json({
        success: true,
        data: partnerProfile
      });
    } catch (error) {
      console.error('Get partner profile controller error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch partner profile'
      });
    }
  }

 async updateProfile(req, res) {
  try {
    console.log('Update profile request body:', req.body);
    console.log('Update profile request file:', req.file ? {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'No file uploaded');
    
    // Ensure req.user is populated by authentication middleware
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized: User not found' 
      });
    }
    
    console.log('Authenticated partner ID:', req.user.id);
    
    const partnerId = req.user.id;
    const updateData = req.body;
    const file = req.file; // This comes from multer middleware
    
    // Validate required fields
    if (!updateData.firstName || !updateData.lastName || !updateData.companyName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: firstName, lastName, and companyName are required'
      });
    }
    
    console.log('Processing update for partner:', partnerId);
    console.log('Update data fields:', Object.keys(updateData));
    console.log('File present:', !!file);
    
    const updatedProfile = await partnerService.updatePartnerProfile(
      partnerId, 
      updateData, 
      file
    );
    
    console.log('Profile update completed successfully');
    
    res.status(200).json({
      success: true,
      data: updatedProfile,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update partner profile failed:', error);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
}

  async uploadProfileImage(req, res) {
    try {
      const partnerId = req.user.id;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'No file provided'
        });
      }
      
      console.log('Uploading profile image for partner:', partnerId);
      console.log('File details:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });
      
      const imageUrl = await partnerService.uploadProfileImage(file, partnerId);
      
      // Update partner profile with new image URL
      const updatedProfile = await partnerService.updatePartnerProfile(
        partnerId, 
        {}, // No other data to update
        file
      );
      
      res.status(200).json({
        success: true,
        data: {
          profile_image: imageUrl,
          partner: updatedProfile
        },
        message: 'Profile image uploaded successfully'
      });
    } catch (error) {
      console.error('Profile image upload failed:', error.message);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  }

  // Fixed: Move this method to use service layer instead of direct DB access
  async approvePartner(req, res) {
    try {
      const { partnerId } = req.params;
      
      // Use the service layer instead of direct supabase access
      const result = await partnerService.approvePartner(partnerId);
      
      res.json({ 
        success: true, 
        message: 'Partner approved successfully',
        partner: result.partner
      });
    } catch (error) {
      console.error('Partner approval failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  }

  // Add missing methods that might be needed
  async forgotPassword(req, res) {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const result = await partnerService.forgotPassword(email);
      res.json(result);
    } catch (error) {
      console.error('Forgot password failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  }

  async resetPassword(req, res) {
    try {
      const { accessToken, newPassword } = req.body;
      
      if (!accessToken || !newPassword) {
        return res.status(400).json({ error: 'Access token and new password are required' });
      }

      const result = await partnerService.resetPassword(accessToken, newPassword);
      res.json(result);
    } catch (error) {
      console.error('Reset password failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  }

  // ADD: Get payout history
  async getPayouts(req, res) {
  try {
    const partnerId = req.user.id;
    const { status, limit = 50 } = req.query;
    
    const payouts = await partnerService.getPartnerPayouts(partnerId, { status, limit });
    
    res.json({
      success: true,
      data: payouts,
      message: 'Payout history retrieved successfully'
    });
  } catch (error) {
    console.error('Get partner payouts failed:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to fetch payout history'
    });
  }
}


async getCommissionSummary(req, res) {
  try {
    console.log('📍 Getting commission summary for partner:', req.partner?.id);
    
    const partnerId = req.user.id;
    if (!partnerId) {
      return res.status(401).json({
        success: false,
        message: 'Partner not authenticated'
      });
    }

    // Extract query parameters
    const { startDate, endDate } = req.query;
    
    // Validate date format if provided
    if (startDate && isNaN(Date.parse(startDate))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid startDate format. Use YYYY-MM-DD format.'
      });
    }
    
    if (endDate && isNaN(Date.parse(endDate))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid endDate format. Use YYYY-MM-DD format.'
      });
    }

    const summary = await partnerService.getCommissionSummary(
      partnerId, 
      startDate, 
      endDate
    );

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('Get commission summary failed:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch commission summary',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

  // ADD: Get specific payout details
  async getPayoutDetails(req, res) {
    try {
      const { payoutId } = req.params;
      const payout = await partnerService.getPayoutDetails(req.user.id, payoutId);
      res.json(payout);
    } catch (error) {
      console.error('Get payout details failed:', error.message);
      res.status(400).json({ error: error.message });
    }
  }

  // ADD: Get specific booking details
  async getBookingDetails(req, res) {
  try {
    const partnerId = req.user.id; 
    console.log('🔍 Partner ID from token:', partnerId);
    const { bookingId } = req.params;
    
    const booking = await partnerService.getBookingDetails(partnerId, bookingId);
    
    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Get booking details error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch booking details'
    });
  }
}
}

module.exports = PartnerController;