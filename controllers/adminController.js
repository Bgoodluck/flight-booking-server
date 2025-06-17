const AdminService = require('../services/adminService');
const adminService = new AdminService();

class AdminController {
  async getDashboard(req, res) {
    try {
      const stats = await adminService.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async manageUsers(req, res) {
    try {
      const { action, userId } = req.params;
      const result = await adminService.manageUsers(action, userId, req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getAllPartners(req, res) {
    try {
      const { page = 1, limit = 20, status, search, ...otherFilters } = req.query;
      
      // Clean up filters - only include non-empty values
      const filters = {};
      
      if (status && status.trim()) {
        filters.status = status.trim();
      }
      
      if (search && search.trim()) {
        filters.search = search.trim();
      }
      
      // Add any other filters that are not empty
      Object.keys(otherFilters).forEach(key => {
        if (otherFilters[key] && otherFilters[key].toString().trim()) {
          filters[key] = otherFilters[key];
        }
      });
      
      console.log('📊 Admin Controller - getAllPartners called with:', {
        page: parseInt(page),
        limit: parseInt(limit),
        filters
      });
      
      const result = await adminService.getAllPartners(
        parseInt(page), 
        parseInt(limit), 
        filters
      );
      
      console.log('✅ Admin Controller - Partners fetched successfully:', {
        count: result.partners?.length || 0,
        total: result.pagination?.total || 0
      });
      
      res.json(result);
    } catch (error) {
      console.error('❌ Admin Controller - Error fetching partners:', error);
      res.status(400).json({ 
        error: error.message,
        details: 'Failed to fetch partners'
      });
    }
}

// Also fix the managePartners method for better error handling
async managePartners(req, res) {
    try {
      const { action, partnerId } = req.params;
      
      console.log('🔧 Admin Controller - managePartners called:', {
        action,
        partnerId,
        body: req.body
      });
      
      // Validate action
      const validActions = ['approve', 'reject', 'suspend', 'activate', 'update_commission', 'update'];
      if (!validActions.includes(action)) {
        return res.status(400).json({
          error: 'Invalid action',
          message: `Action must be one of: ${validActions.join(', ')}`
        });
      }
      
      // Validate partnerId
      if (!partnerId) {
        return res.status(400).json({
          error: 'Missing partner ID',
          message: 'Partner ID is required'
        });
      }
      
      const result = await adminService.managePartners(action, partnerId, req.body);
      
      console.log('✅ Admin Controller - Partner action completed:', {
        action,
        partnerId,
        result: result.message
      });
      
      res.json(result);
    } catch (error) {
      console.error('❌ Admin Controller - Error managing partner:', error);
      res.status(400).json({ 
        error: error.message,
        details: `Failed to ${req.params.action} partner`
      });
    }
}

  async getAllBookings(req, res) {
  console.log('🔧 AdminController - getAllBookings called:', req.query);
  
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      search, 
      startDate, 
      endDate, 
      bookingType,
      sortBy,
      sortOrder
    } = req.query;

    const filters = {
      status,
      search,
      startDate,
      endDate,
      bookingType,
      sortBy,
      sortOrder
    };

    // Remove undefined/null values from filters (matching your pattern)
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined || filters[key] === null || filters[key] === '') {
        delete filters[key];
      }
    });

    const bookings = await adminService.getAllBookings(page, limit, filters);
    
    console.log('✅ AdminController - getAllBookings successful');
    res.json(bookings);
  } catch (error) {
    console.error('❌ AdminController - Error in getAllBookings:', error);
    res.status(400).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async getBookingDetails(req, res) {
  console.log('🔧 AdminController - getBookingDetails called:', req.params);
  
  try {
    const { bookingId } = req.params;
    
    if (!bookingId) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }
    
    const booking = await adminService.getBookingDetails(bookingId);
    
    console.log('✅ AdminController - getBookingDetails successful');
    res.json(booking);
  } catch (error) {
    console.error('❌ AdminController - Error in getBookingDetails:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ 
        error: 'Booking not found',
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(400).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

  async processRefund(req, res) {
    try {
      const { refundId, action } = req.params;
      const result = await adminService.processRefundRequest(refundId, action, req.user.id);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async generateReports(req, res) {
    try {
      const { reportType } = req.params;
      const { startDate, endDate } = req.query;
      const report = await adminService.generateReports(reportType, { startDate, endDate });
      res.json(report);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async managePromoCodes(req, res) {
    try {
      const { action } = req.params;
      const { promoId } = req.query;
      let result;
      
      switch (action) {
        case 'create':
          result = await adminService.managePromoCodes('create', req.body);
          break;
        case 'update':
          result = await adminService.managePromoCodes('update', req.body, promoId);
          break;
        case 'activate':
          result = await adminService.managePromoCodes('activate', null, promoId);
          break;
        case 'deactivate':
          result = await adminService.managePromoCodes('deactivate', null, promoId);
          break;
        default:
          return res.status(400).json({ error: 'Invalid action' });
      }
      
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async sendNotification(req, res) {
    try {
      const { type, message, recipients } = req.body;
      // This method doesn't exist in AdminService, you'll need to implement it
      // const result = await adminService.sendBroadcastNotification(type, message, recipients);
      res.status(501).json({ error: 'Notification feature not implemented yet' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getAllUsers(req, res) {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await adminService.getAllUsers(page, limit, filters);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  

  async getAllRefunds(req, res) {
    try {
      const { page = 1, limit = 20, ...filters } = req.query;
      const result = await adminService.getAllRefunds(page, limit, filters);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // async getBookingDetails(req, res) {
  //   try {
  //     const { bookingId } = req.params;
  //     const booking = await adminService.getBookingDetails(bookingId);
  //     res.json(booking);
  //   } catch (error) {
  //     res.status(400).json({ error: error.message });
  //   }
  // }

  async getSystemLogs(req, res) {
    try {
      const { page = 1, limit = 50, ...filters } = req.query;
      const result = await adminService.getSystemLogs(page, limit, filters);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async updateSystemSettings(req, res) {
    try {
      const result = await adminService.updateSystemSettings(req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getSystemSettings(req, res) {
    try {
      const settings = await adminService.getSystemSettings();
      res.json(settings);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }


  async approvePayout(req, res) {
  try {
    const { payoutId } = req.params;
    // const adminId = req.user.id; // Assuming admin authentication
    
    if (!payoutId) {
      return res.status(400).json({
        success: false,
        error: 'Payout ID is required'
      });
    }
    
    const result = await adminService.approvePayout(payoutId, adminId);
    
    res.json({
      success: true,
      data: result,
      message: 'Payout approved successfully'
    });
  } catch (error) {
    console.error('Payout approval failed:', error.message);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
}
}

module.exports = AdminController;