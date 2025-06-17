const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/emailService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class AdminService {
  async getDashboardStats() {
    try {
      // Get various statistics
      const [
        { count: totalUsers },
        { count: totalBookings },
        { count: totalPartners },
        { data: revenueData }
      ] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('bookings').select('*', { count: 'exact', head: true }),
        supabase.from('partners').select('*', { count: 'exact', head: true }),
        supabase.from('bookings').select('total_amount, created_at').eq('status', 'confirmed')
      ]);

      const totalRevenue = revenueData.reduce((sum, booking) => sum + booking.total_amount, 0);
      const monthlyRevenue = revenueData
        .filter(booking => new Date(booking.created_at) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .reduce((sum, booking) => sum + booking.total_amount, 0);

      // Get pending approvals count
      const { count: pendingPartners } = await supabase
        .from('partners')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: pendingRefunds } = await supabase
        .from('refunds')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      return {
        totalUsers,
        totalBookings,
        totalPartners,
        totalRevenue,
        monthlyRevenue,
        pendingPartners,
        pendingRefunds
      };
    } catch (error) {
      throw error;
    }
  }

  async manageUsers(action, userId, data = {}) {
    try {
      switch (action) {
        case 'suspend':
          await supabase
            .from('users')
            .update({ 
              status: 'suspended',
              suspended_at: new Date().toISOString()
            })
            .eq('id', userId);
          break;
        case 'activate':
          await supabase
            .from('users')
            .update({ 
              status: 'active',
              suspended_at: null
            })
            .eq('id', userId);
          break;
        case 'update':
          await supabase
            .from('users')
            .update({
              ...data,
              updated_at: new Date().toISOString()
            })
            .eq('id', userId);
          break;
        case 'delete':
          await supabase
            .from('users')
            .update({
              status: 'deleted',
              email: `deleted_${Date.now()}@deleted.com`,
              deleted_at: new Date().toISOString()
            })
            .eq('id', userId);
          break;
      }

      return { message: `User ${action} successful` };
    } catch (error) {
      throw error;
    }
  }

  async getAllUsers(page = 1, limit = 20, filters = {}) {
    try {
      const offset = (page - 1) * limit;
      let query = supabase
        .from('users')
        .select(`
          id,
          email,
          first_name,
          last_name,
          phone,
          status,
          email_verified,
          wallet_balance,
          created_at,
          last_login
        `, { count: 'exact' })
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      // Apply filters
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.email_verified !== undefined) {
        query = query.eq('email_verified', filters.email_verified);
      }
      if (filters.search) {
        query = query.or(`email.ilike.%${filters.search}%,first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%`);
      }

      const { data: users, error, count } = await query;

      if (error) throw error;

      return {
        users,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Enhanced managePartners method with comprehensive error handling and validation
   */
  async managePartners(action, partnerId, data = {}) {
    console.log(`🔧 AdminService - managePartners called:`, { action, partnerId, data });

    try {
      // Validate inputs
      if (!partnerId) {
        throw new Error('Partner ID is required');
      }

      const validActions = ['approve', 'reject', 'suspend', 'activate', 'update_commission', 'update'];
      if (!validActions.includes(action)) {
        throw new Error(`Invalid action: ${action}. Valid actions are: ${validActions.join(', ')}`);
      }

      // Fetch current partner data
      const { data: partner, error: fetchError } = await supabase
        .from('partners')
        .select('*')
        .eq('id', partnerId)
        .single();

      if (fetchError) {
        console.error('❌ Error fetching partner:', fetchError);
        throw new Error(`Partner not found: ${fetchError.message}`);
      }

      if (!partner) {
        throw new Error('Partner not found');
      }

      console.log(`📋 Current partner status: ${partner.status}`);

      let updateData = {};
      let emailData = null;

      // Prepare update data based on action
      switch (action) {
        case 'approve':
          if (partner.status === 'approved') {
            console.log('⚠️ Partner already approved');
            return { message: 'Partner is already approved', partner };
          }
          
          updateData = { 
            status: 'approved', 
            approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          
          emailData = {
            to: partner.email,
            subject: 'Partner Application Approved - Elevatio',
            template: 'partner-approval',
            data: { 
              businessName: partner.business_name,
              contactPerson: partner.contact_person
            }
          };
          break;

        case 'reject':
          if (partner.status === 'rejected') {
            console.log('⚠️ Partner already rejected');
            return { message: 'Partner is already rejected', partner };
          }
          
          updateData = { 
            status: 'rejected',
            rejected_at: new Date().toISOString(),
            rejection_reason: data.reason || 'Application rejected',
            updated_at: new Date().toISOString()
          };
          
          emailData = {
            to: partner.email,
            subject: 'Partner Application Update - Elevatio',
            template: 'partner-rejection',
            data: { 
              businessName: partner.business_name,
              contactPerson: partner.contact_person,
              reason: data.reason
            }
          };
          break;

        case 'suspend':
          if (partner.status === 'suspended') {
            console.log('⚠️ Partner already suspended');
            return { message: 'Partner is already suspended', partner };
          }
          
          updateData = { 
            status: 'suspended',
            suspended_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          break;

        case 'activate':
          if (partner.status === 'suspended') {
            updateData = { 
              status: 'approved',
              suspended_at: null,
              updated_at: new Date().toISOString()
            };
          } else if (partner.status === 'approved') {
            console.log('⚠️ Partner already active');
            return { message: 'Partner is already active', partner };
          } else {
            throw new Error('Cannot activate partner that is not suspended or approved');
          }
          break;

        case 'update_commission':
          if (!data.commissionRate && data.commissionRate !== 0) {
            throw new Error('Commission rate is required');
          }
          
          const commissionRate = parseFloat(data.commissionRate);
          if (isNaN(commissionRate) || commissionRate < 0 || commissionRate > 1) {
            throw new Error('Commission rate must be a number between 0 and 1');
          }
          
          updateData = { 
            commission_rate: commissionRate,
            updated_at: new Date().toISOString()
          };
          break;

        case 'update':
          updateData = {
            ...data,
            updated_at: new Date().toISOString()
          };
          break;

        default:
          throw new Error(`Invalid action: ${action}`);
      }

      console.log(`🔄 Updating partner with data:`, updateData);

      // Perform the database update
      const { data: updatedPartner, error: updateError } = await supabase
        .from('partners')
        .update(updateData)
        .eq('id', partnerId)
        .select('*')
        .single();

      if (updateError) {
        console.error('❌ Database update error:', updateError);
        throw new Error(`Failed to update partner: ${updateError.message}`);
      }

      if (!updatedPartner) {
        console.error('❌ No data returned from update');
        throw new Error('Update failed: No data returned');
      }

      console.log(`✅ Partner updated successfully:`, {
        id: updatedPartner.id,
        oldStatus: partner.status,
        newStatus: updatedPartner.status,
        updatedAt: updatedPartner.updated_at
      });

      // Send email notification if needed (don't let email failures break the update)
      if (emailData) {
        try {
          console.log(`📧 Sending ${action} email to:`, emailData.to);
          await sendEmail(emailData);
          console.log(`✅ Email sent successfully for ${action}`);
        } catch (emailError) {
          console.error(`⚠️ Email sending failed for ${action}:`, emailError);
          // Don't throw error for email failures, just log it
        }
      }

      // Return success with updated partner data
      return { 
        message: `Partner ${action} successful`,
        partner: updatedPartner,
        previousStatus: partner.status,
        newStatus: updatedPartner.status
      };

    } catch (error) {
      console.error(`❌ AdminService - Error in ${action} partner:`, error);
      
      // Provide more specific error messages
      if (error.message.includes('not found')) {
        throw new Error(`Partner with ID ${partnerId} not found`);
      }
      
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        throw new Error('Partner update failed due to data conflict');
      }
      
      // Re-throw with original message if it's already descriptive
      throw error;
    }
  }

  /**
   * Enhanced getAllPartners method with comprehensive filtering, pagination, and error handling
   */
  async getAllPartners(page = 1, limit = 20, filters = {}) {
    console.log('🔍 AdminService - getAllPartners called with:', { page, limit, filters });

    try {
      // Validate and sanitize pagination parameters
      const validatedPage = Math.max(1, parseInt(page) || 1);
      const validatedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20)); // Max 100 records per page
      const offset = (validatedPage - 1) * validatedLimit;

      console.log('📊 Validated pagination:', { page: validatedPage, limit: validatedLimit, offset });

      // Build the base query with comprehensive field selection
      let query = supabase
        .from('partners')
        .select(`
          id, 
          business_name, 
          email, 
          contact_person, 
          phone, 
          status, 
          commission_rate, 
          available_balance,
          created_at, 
          updated_at, 
          approved_at, 
          rejected_at, 
          suspended_at,
          rejection_reason,
          business_type,
          address,
          city,
          state,
          country,
          postal_code,
          website,
          description
        `, { count: 'exact' });

      // Apply status filter
      if (filters.status && filters.status.trim()) {
        const statusFilter = filters.status.trim().toLowerCase();
        console.log('🔍 Applying status filter:', statusFilter);
        query = query.eq('status', statusFilter);
      }

      // Apply comprehensive search filter
      if (filters.search && filters.search.trim()) {
        const searchTerm = filters.search.trim();
        console.log('🔍 Applying search filter:', searchTerm);
        
        // Search across multiple fields using OR condition
        const searchConditions = [
          `business_name.ilike.%${searchTerm}%`,
          `email.ilike.%${searchTerm}%`,
          `contact_person.ilike.%${searchTerm}%`,
          `phone.ilike.%${searchTerm}%`,
          `business_type.ilike.%${searchTerm}%`,
          `city.ilike.%${searchTerm}%`,
          `description.ilike.%${searchTerm}%`
        ].join(',');

        query = query.or(searchConditions);
      }

      // Apply additional filters
      if (filters.businessType && filters.businessType.trim()) {
        console.log('🔍 Applying business type filter:', filters.businessType);
        query = query.eq('business_type', filters.businessType.trim());
      }

      if (filters.city && filters.city.trim()) {
        console.log('🔍 Applying city filter:', filters.city);
        query = query.ilike('city', `%${filters.city.trim()}%`);
      }

      if (filters.country && filters.country.trim()) {
        console.log('🔍 Applying country filter:', filters.country);
        query = query.eq('country', filters.country.trim());
      }

      // Apply date range filters
      if (filters.createdAfter) {
        console.log('🔍 Applying created after filter:', filters.createdAfter);
        query = query.gte('created_at', filters.createdAfter);
      }

      if (filters.createdBefore) {
        console.log('🔍 Applying created before filter:', filters.createdBefore);
        query = query.lte('created_at', filters.createdBefore);
      }

      // Apply commission rate filters
      if (filters.minCommission !== undefined && filters.minCommission !== null) {
        console.log('🔍 Applying min commission filter:', filters.minCommission);
        query = query.gte('commission_rate', parseFloat(filters.minCommission));
      }

      if (filters.maxCommission !== undefined && filters.maxCommission !== null) {
        console.log('🔍 Applying max commission filter:', filters.maxCommission);
        query = query.lte('commission_rate', parseFloat(filters.maxCommission));
      }

      // Apply sorting
      const sortBy = filters.sortBy || 'created_at';
      const sortOrder = filters.sortOrder === 'asc' ? false : true; // true for descending (default)
      
      console.log('📈 Applying sort:', { sortBy, sortOrder: sortOrder ? 'desc' : 'asc' });
      query = query.order(sortBy, { ascending: !sortOrder });

      // Apply pagination
      query = query.range(offset, offset + validatedLimit - 1);

      // Execute the query
      console.log('🚀 Executing partners query...');
      const { data: partners, error, count } = await query;

      if (error) {
        console.error('❌ Database query error:', error);
        throw new Error(`Failed to fetch partners: ${error.message}`);
      }

      if (!partners) {
        console.warn('⚠️ No partners data returned');
        return {
          partners: [],
          pagination: {
            total: 0,
            page: validatedPage,
            limit: validatedLimit,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false
          }
        };
      }

      // Calculate pagination metadatacommission
      const totalRecords = count || 0;
      const totalPages = Math.ceil(totalRecords / validatedLimit);
      const hasNextPage = validatedPage < totalPages;
      const hasPreviousPage = validatedPage > 1;

      console.log('✅ Partners query successful:', {
        partnersCount: partners.length,
        totalRecords,
        totalPages,
        currentPage: validatedPage,
        hasNextPage,
        hasPreviousPage
      });

      // Process partners data to ensure consistency
      const processedPartners = partners.map(partner => ({
        ...partner,
        // Ensure commission_rate is properly formatted
        commission_rate: partner.commission_rate ? parseFloat(partner.commission_rate) : 0,
        // Ensure available_balance is properly formatted
        available_balance: partner.available_balance ? parseFloat(partner.available_balance) : 0,
        // Format dates consistently
        created_at: partner.created_at ? new Date(partner.created_at).toISOString() : null,
        updated_at: partner.updated_at ? new Date(partner.updated_at).toISOString() : null,
        approved_at: partner.approved_at ? new Date(partner.approved_at).toISOString() : null,
        rejected_at: partner.rejected_at ? new Date(partner.rejected_at).toISOString() : null,
        suspended_at: partner.suspended_at ? new Date(partner.suspended_at).toISOString() : null,
        // Ensure status is consistent
        status: partner.status ? partner.status.toLowerCase() : 'pending'
      }));

      // Return structured response
      return {
        partners: processedPartners,
        pagination: {
          total: totalRecords,
          page: validatedPage,
          limit: validatedLimit,
          totalPages,
          hasNextPage,
          hasPreviousPage,
          offset
        },
        filters: {
          ...filters,
          applied: Object.keys(filters).filter(key => 
            filters[key] !== undefined && 
            filters[key] !== null && 
            filters[key] !== ''
          )
        },
        metadata: {
          queryTime: new Date().toISOString(),
          resultsCount: processedPartners.length
        }
      };

    } catch (error) {
      console.error('❌ AdminService - Error in getAllPartners:', error);
      
      // Provide more specific error messages
      if (error.message.includes('permission')) {
        throw new Error('Insufficient permissions to access partners data');
      }
      
      if (error.message.includes('connection')) {
        throw new Error('Database connection error. Please try again.');
      }
      
      if (error.message.includes('timeout')) {
        throw new Error('Query timeout. Please try with more specific filters.');
      }
      
      // Re-throw with original message if it's already descriptive
      throw error;
    }
  }

  /**
   * Get partner statistics for dashboard
   */
  async getPartnerStats() {
    console.log('📊 AdminService - getPartnerStats called');

    try {
      // Get counts by status
      const { data: partners, error } = await supabase
        .from('partners')
        .select('status, created_at');

      if (error) {
        throw new Error(`Failed to fetch partner statistics: ${error.message}`);
      }

      // Calculate statistics
      const stats = {
        total: partners.length,
        pending: partners.filter(p => p.status === 'pending').length,
        approved: partners.filter(p => p.status === 'approved').length,
        rejected: partners.filter(p => p.status === 'rejected').length,
        suspended: partners.filter(p => p.status === 'suspended').length
      };

      // Get recent activity (partners created in last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentCount = partners.filter(p => 
        new Date(p.created_at) >= thirtyDaysAgo
      ).length;

      console.log('✅ Partner statistics retrieved:', stats);

      return {
        ...stats,
        recentSignups: recentCount,
        lastUpdated: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ AdminService - Error in getPartnerStats:', error);
      throw error;
    }
  }

  // 8. Method to approve payout (for admin use)

async approvePayout(payoutId, adminId = null) {
  try {
    console.log(`Processing payout approval: ${payoutId}`);

    // Get payout details with partner info
    const { data: payout, error: fetchError } = await supabase
      .from('payouts')
      .select(`
        *,
        partners!inner(available_balance, business_name, email, first_name, last_name)
      `)
      .eq('id', payoutId)
      .single();

    if (fetchError || !payout) {
      console.error('Payout fetch error:', fetchError);
      throw new Error('Payout not found');
    }

    if (payout.status !== 'pending') {
      throw new Error(`Cannot approve payout with status: ${payout.status}`);
    }

    const partner = payout.partners;
    const payoutAmount = parseFloat(payout.amount);
    const currentAvailableBalance = parseFloat(partner.available_balance) || 0;

    // Verify partner still has sufficient balance
    if (currentAvailableBalance < payoutAmount) {
      throw new Error(`Insufficient partner balance. Available: $${currentAvailableBalance.toFixed(2)}, Required: $${payoutAmount.toFixed(2)}`);
    }

    // Start transaction-like operations
    try {
      // 1. Update payout status to approved
      const { error: updatePayoutError } = await supabase
        .from('payouts')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: adminId,
          processed_at: new Date().toISOString()
        })
        .eq('id', payoutId);

      if (updatePayoutError) {
        throw new Error(`Failed to approve payout: ${updatePayoutError.message}`);
      }

      // 2. Deduct amount from partner's available balance
      const newAvailableBalance = currentAvailableBalance - payoutAmount;
      
      const { error: partnerUpdateError } = await supabase
        .from('partners')
        .update({
          available_balance: newAvailableBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', payout.partner_id);

      if (partnerUpdateError) {
        console.error('Partner balance update error:', partnerUpdateError);
        
        // Rollback payout approval
        await supabase
          .from('payouts')
          .update({
            status: 'pending',
            approved_at: null,
            approved_by: null,
            processed_at: null
          })
          .eq('id', payoutId);
        
        throw new Error(`Failed to update partner balance: ${partnerUpdateError.message}`);
      }

      console.log(`✅ Payout approved successfully: ${payoutId}`);
      console.log(`✅ Partner ${partner.business_name} balance updated: $${currentAvailableBalance} → $${newAvailableBalance}`);

      // Send approval notification email
      try {
        await this.sendPayoutApprovalEmail(partner, payout, newAvailableBalance);
      } catch (emailError) {
        console.warn('Failed to send payout approval email:', emailError);
      }

      return { 
        message: 'Payout approved successfully',
        payout_id: payoutId,
        amount: payoutAmount,
        partner_name: partner.business_name,
        previous_balance: currentAvailableBalance,
        new_balance: newAvailableBalance
      };

    } catch (transactionError) {
      console.error('Transaction error during payout approval:', transactionError);
      throw transactionError;
    }
    
  } catch (error) {
    console.error('Error approving payout:', error);
    throw error;
  }
}

async rejectPayout(payoutId, adminId = null, rejectionReason = '') {
  try {
    console.log(`Processing payout rejection: ${payoutId}`);

    const { data: payout, error: fetchError } = await supabase
      .from('payouts')
      .select(`
        *,
        partners!inner(business_name, email, first_name, last_name)
      `)
      .eq('id', payoutId)
      .single();

    if (fetchError || !payout) {
      throw new Error('Payout not found');
    }

    if (payout.status !== 'pending') {
      throw new Error(`Cannot reject payout with status: ${payout.status}`);
    }

    // Update payout status to rejected
    const { error: updateError } = await supabase
      .from('payouts')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejected_by: adminId,
        rejection_reason: rejectionReason || 'Rejected by admin'
      })
      .eq('id', payoutId);

    if (updateError) {
      throw new Error('Failed to reject payout');
    }

    console.log(`✅ Payout rejected successfully: ${payoutId}`);

    // Send rejection notification email
    try {
      await this.sendPayoutRejectionEmail(payout.partners, payout, rejectionReason);
    } catch (emailError) {
      console.warn('Failed to send payout rejection email:', emailError);
    }

    return { 
      message: 'Payout rejected successfully',
      payout_id: payoutId,
      rejection_reason: rejectionReason
    };
    
  } catch (error) {
    console.error('Error rejecting payout:', error);
    throw error;
  }
}

async sendPayoutApprovalEmail(partner, payout, newBalance) {
  try {
    if (!emailService || typeof emailService.sendEmail !== 'function') {
      console.warn('Email service not available');
      return;
    }

    await emailService.sendEmail({
      to: partner.email,
      subject: 'Payout Approved - Funds Processed',
      template: 'payout-approval',
      data: {
        partner_name: partner.first_name,
        business_name: partner.business_name,
        amount: payout.amount,
        net_amount: payout.net_amount,
        processing_fee: payout.processing_fee,
        payout_id: payout.id,
        approved_at: new Date(payout.approved_at).toLocaleDateString(),
        new_balance: newBalance.toFixed(2)
      }
    });
    
  } catch (error) {
    console.error('Error sending payout approval email:', error);
  }
}

// Helper method to send payout rejection notification email
async sendPayoutRejectionEmail(partner, payout, rejectionReason) {
  try {
    if (!emailService || typeof emailService.sendEmail !== 'function') {
      console.warn('Email service not available');
      return;
    }

    await emailService.sendEmail({
      to: partner.email,
      subject: 'Payout Request Rejected',
      template: 'payout-rejection',
      data: {
        partner_name: partner.first_name,
        business_name: partner.business_name,
        amount: payout.amount,
        payout_id: payout.id,
        rejection_reason: rejectionReason || 'No reason provided',
        rejected_at: new Date().toLocaleDateString()
      }
    });
    
  } catch (error) {
    console.error('Error sending payout rejection email:', error);
  }
}


async getAllPayouts(page = 1, limit = 20, filters = {}) {
  try {
    console.log('Fetching all payouts with filters:', filters);

    const validatedPage = Math.max(1, parseInt(page) || 1);
    const validatedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (validatedPage - 1) * validatedLimit;

    let query = supabase
      .from('payouts')
      .select(`
        *,
        partners!inner(business_name, email, first_name, last_name)
      `, { count: 'exact' });

    // Apply status filter
    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    // Apply date range filter
    if (filters.startDate) {
      query = query.gte('requested_at', filters.startDate);
    }
    if (filters.endDate) {
      const endDateTime = new Date(filters.endDate);
      endDateTime.setHours(23, 59, 59, 999);
      query = query.lte('requested_at', endDateTime.toISOString());
    }

    // Apply search filter
    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      query = query.or(`partners.business_name.ilike.%${searchTerm}%,partners.email.ilike.%${searchTerm}%`);
    }

    // Apply sorting
    const sortBy = filters.sortBy || 'requested_at';
    const sortOrder = filters.sortOrder === 'asc' ? false : true;
    query = query.order(sortBy, { ascending: !sortOrder });

    // Apply pagination
    query = query.range(offset, offset + validatedLimit - 1);

    const { data: payouts, error, count } = await query;

    if (error) {
      console.error('Error fetching payouts:', error);
      throw new Error(`Failed to fetch payouts: ${error.message}`);
    }

    const totalRecords = count || 0;
    const totalPages = Math.ceil(totalRecords / validatedLimit);

    return {
      payouts: payouts || [],
      pagination: {
        total: totalRecords,
        page: validatedPage,
        limit: validatedLimit,
        totalPages,
        hasNextPage: validatedPage < totalPages,
        hasPreviousPage: validatedPage > 1
      }
    };

  } catch (error) {
    console.error('Error in getAllPayouts:', error);
    throw error;
  }
}

  async processRefundRequest(refundId, action, adminId) {
    try {
      const { data: refund, error } = await supabase
        .from('refunds')
        .select(`
          *,
          bookings(booking_reference, total_amount),
          users(email, first_name, last_name)
        `)
        .eq('id', refundId)
        .single();

      if (error || !refund) {
        throw new Error('Refund request not found');
      }

      if (action === 'approve') {
        // Process refund
        await supabase.rpc('add_to_wallet', {
          user_id: refund.user_id,
          amount: refund.amount
        });

        await supabase
          .from('refunds')
          .update({
            status: 'approved',
            processed_by: adminId,
            processed_at: new Date().toISOString()
          })
          .eq('id', refundId);

        // Send approval email
        if (refund.users) {
          await sendEmail({
            to: refund.users.email,
            subject: 'Refund Approved - Elevatio',
            template: 'refund-approval',
            data: {
              userName: refund.users.first_name,
              amount: refund.amount,
              bookingReference: refund.bookings?.booking_reference
            }
          });
        }
      } else {
        await supabase
          .from('refunds')
          .update({
            status: 'rejected',
            processed_by: adminId,
            processed_at: new Date().toISOString()
          })
          .eq('id', refundId);

        // Send rejection email
        if (refund.users) {
          await sendEmail({
            to: refund.users.email,
            subject: 'Refund Request Update - Elevatio',
            template: 'refund-rejection',
            data: {
              userName: refund.users.first_name,
              amount: refund.amount,
              bookingReference: refund.bookings?.booking_reference
            }
          });
        }
      }

      return { message: `Refund ${action}d successfully` };
    } catch (error) {
      throw error;
    }
  }

  async getAllRefunds(page = 1, limit = 20, filters = {}) {
    try {
      const offset = (page - 1) * limit;
      let query = supabase
        .from('refunds')
        .select(`
          id,
          amount,
          status,
          created_at,
          processed_at,
          bookings(booking_reference),
          users(email, first_name, last_name)
        `, { count: 'exact' })
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      const { data: refunds, error, count } = await query;

      if (error) throw error;

      return {
        refunds,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      throw error;
    }
  }

  async generateReports(reportType, dateRange) {
    try {
      const { startDate, endDate } = dateRange;
      
      switch (reportType) {
        case 'bookings':
          return await this.generateBookingsReport(startDate, endDate);
        case 'revenue':
          return await this.generateRevenueReport(startDate, endDate);
        case 'partners':
          return await this.generatePartnersReport(startDate, endDate);
        case 'users':
          return await this.generateUsersReport(startDate, endDate);
        default:
          throw new Error('Invalid report type');
      }
    } catch (error) {
      throw error;
    }
  }

  async generateBookingsReport(startDate, endDate) {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(`
        id,
        booking_reference,
        total_amount,
        status,
        booking_type,
        created_at,
        passengers(first_name, last_name),
        users(email, first_name, last_name),
        partners(business_name)
      `)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const summary = {
      totalBookings: bookings.length,
      confirmedBookings: bookings.filter(b => b.status === 'confirmed').length,
      cancelledBookings: bookings.filter(b => b.status === 'cancelled').length,
      pendingBookings: bookings.filter(b => b.status === 'pending_payment').length,
      totalValue: bookings.reduce((sum, b) => sum + b.total_amount, 0),
      confirmedValue: bookings
        .filter(b => b.status === 'confirmed')
        .reduce((sum, b) => sum + b.total_amount, 0),
      oneWayBookings: bookings.filter(b => b.booking_type === 'oneway').length,
      roundTripBookings: bookings.filter(b => b.booking_type === 'roundtrip').length
    };

    return {
      reportType: 'bookings',
      period: { startDate, endDate },
      data: bookings,
      summary
    };
  }

  async generateRevenueReport(startDate, endDate) {
    const { data: revenue, error } = await supabase
      .from('bookings')
      .select(`
        total_amount, 
        commission_earned, 
        discount_amount,
        created_at,
        partners(business_name, commission_rate)
      `)
      .eq('status', 'confirmed')
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;

    const summary = {
      totalRevenue: revenue.reduce((sum, r) => sum + r.total_amount, 0),
      totalCommissions: revenue.reduce((sum, r) => sum + (r.commission_earned || 0), 0),
      totalDiscounts: revenue.reduce((sum, r) => sum + (r.discount_amount || 0), 0),
      netRevenue: revenue.reduce((sum, r) => sum + r.total_amount - (r.commission_earned || 0), 0),
      averageBookingValue: revenue.length > 0 ? 
        revenue.reduce((sum, r) => sum + r.total_amount, 0) / revenue.length : 0,
      partnerBookings: revenue.filter(r => r.partners).length,
      directBookings: revenue.filter(r => !r.partners).length
    };

    return {
      reportType: 'revenue',
      period: { startDate, endDate },
      data: revenue,
      summary
    };
  }

  async generatePartnersReport(startDate, endDate) {
    const { data: partners, error } = await supabase
      .from('partners')
      .select(`
        id,
        business_name,
        email,
        status,
        commission_rate,
        total_earnings,
        created_at,
        bookings!inner(
          id,
          total_amount,
          commission_earned,
          created_at
        )
      `)
      .gte('bookings.created_at', startDate)
      .lte('bookings.created_at', endDate);

    if (error) throw error;

    // Process partner performance data
    const partnerStats = partners.map(partner => {
      const partnerBookings = partner.bookings || [];
      return {
        ...partner,
        bookings: partnerBookings.length,
        revenue: partnerBookings.reduce((sum, b) => sum + b.total_amount, 0),
        commissions: partnerBookings.reduce((sum, b) => sum + (b.commission_earned || 0), 0)
      };
    });

    const summary = {
      totalPartners: partners.length,
      activePartners: partners.filter(p => p.status === 'approved').length,
      totalCommissions: partnerStats.reduce((sum, p) => sum + p.commissions, 0),
      totalBookings: partnerStats.reduce((sum, p) => sum + p.bookings, 0),
      averageCommissionRate: partners.length > 0 ? 
        partners.reduce((sum, p) => sum + p.commission_rate, 0) / partners.length : 0
    };

    return {
      reportType: 'partners',
      period: { startDate, endDate },
      data: partnerStats,
      summary
    };
  }

  async generateUsersReport(startDate, endDate) {
    const { data: users, error } = await supabase
      .from('users')
      .select(`
        id,
        email,
        status,
        email_verified,
        wallet_balance,
        created_at,
        last_login,
        bookings(
          id,
          total_amount,
          status,
          created_at
        )
      `)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;

    const summary = {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.status === 'active').length,
      verifiedUsers: users.filter(u => u.email_verified).length,
      usersWithBookings: users.filter(u => u.bookings && u.bookings.length > 0).length,
      totalWalletBalance: users.reduce((sum, u) => sum + (u.wallet_balance || 0), 0),
      averageWalletBalance: users.length > 0 ? 
        users.reduce((sum, u) => sum + (u.wallet_balance || 0), 0) / users.length : 0
    };

    return {
      reportType: 'users',
      period: { startDate, endDate },
      data: users,
      summary
    };
  }

  async managePromoCodes(action, promoData, promoId = null) {
    try {
      switch (action) {
        case 'create':
          const { data: newPromo, error: createError } = await supabase
            .from('promo_codes')
            .insert({
              code: promoData.code,
              discount_type: promoData.discountType,
              discount_value: promoData.discountValue,
              max_discount: promoData.maxDiscount,
              usage_limit: promoData.usageLimit,
              expiry_date: promoData.expiryDate,
              status: 'active',
              created_by: promoData.adminId
            })
            .select()
            .single();

          if (createError) throw createError;
          return { promo: newPromo, message: 'Promo code created successfully' };

        case 'update':
          const { data: updatedPromo, error: updateError } = await supabase
            .from('promo_codes')
            .update({
              ...promoData,
              updated_at: new Date().toISOString()
            })
            .eq('id', promoId)
            .select()
            .single();

          if (updateError) throw updateError;
          return { promo: updatedPromo, message: 'Promo code updated successfully' };

        case 'deactivate':
          await supabase
            .from('promo_codes')
            .update({ status: 'inactive' })
            .eq('id', promoId);
          return { message: 'Promo code deactivated successfully' };

        case 'activate':
          await supabase
            .from('promo_codes')
            .update({ status: 'active' })
            .eq('id', promoId);
          return { message: 'Promo code activated successfully' };

        default:
          throw new Error('Invalid action');
      }
    } catch (error) {
      throw error;
    }
  }

  async getSystemLogs(page = 1, limit = 50, filters = {}) {
    try {
      const offset = (page - 1) * limit;
      let query = supabase
        .from('system_logs')
        .select('*', { count: 'exact' })
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      if (filters.level) {
        query = query.eq('level', filters.level);
      }
      if (filters.action) {
        query = query.eq('action', filters.action);
      }
      if (filters.startDate && filters.endDate) {
        query = query.gte('created_at', filters.startDate).lte('created_at', filters.endDate);
      }

      const { data: logs, error, count } = await query;

      if (error) throw error;

      return {
        logs,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      throw error;
    }
  }

  async getAllBookings(page = 1, limit = 20, filters = {}) {
  console.log('🔍 AdminService - getAllBookings called with:', { page, limit, filters });
  
  try {
    // Validate and sanitize pagination parameters (matching your pattern)
    const validatedPage = Math.max(1, parseInt(page) || 1);
    const validatedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (validatedPage - 1) * validatedLimit;

    console.log('📊 Validated pagination:', { page: validatedPage, limit: validatedLimit, offset });

    // Build the base query (matching your comprehensive select pattern)
    let query = supabase
      .from('bookings')
      .select(`
        *,
        users(id, email, first_name, last_name, phone),
        partners(id, business_name, email, phone),
        passengers(count),
        payments(id, amount, status, payment_method, created_at),
        seat_selections(count),
        baggage_selections(count)
      `, { count: 'exact' });

    // Apply status filter
    if (filters.status && filters.status.trim() && filters.status !== 'all') {
      const statusFilter = filters.status.trim().toLowerCase();
      console.log('🔍 Applying status filter:', statusFilter);
      query = query.eq('status', statusFilter);
    }

    // Apply booking type filter
    if (filters.bookingType && filters.bookingType.trim() && filters.bookingType !== 'all') {
      console.log('🔍 Applying booking type filter:', filters.bookingType);
      query = query.eq('booking_type', filters.bookingType.trim());
    }

    // Apply date range filter
    if (filters.startDate) {
      console.log('🔍 Applying start date filter:', filters.startDate);
      query = query.gte('created_at', filters.startDate);
    }
    if (filters.endDate) {
      console.log('🔍 Applying end date filter:', filters.endDate);
      // Add end of day to include the entire end date
      const endDateTime = new Date(filters.endDate);
      endDateTime.setHours(23, 59, 59, 999);
      query = query.lte('created_at', endDateTime.toISOString());
    }

    // Apply comprehensive search filter (matching your search pattern)
    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      console.log('🔍 Applying search filter:', searchTerm);
      
      // Search across multiple fields using OR condition
      const searchConditions = [
        `booking_reference.ilike.%${searchTerm}%`,
        `users.email.ilike.%${searchTerm}%`,
        `users.first_name.ilike.%${searchTerm}%`,
        `users.last_name.ilike.%${searchTerm}%`,
        `partners.business_name.ilike.%${searchTerm}%`
      ].join(',');

      query = query.or(searchConditions);
    }

    // Apply sorting (matching your pattern)
    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder === 'asc' ? false : true;
    
    console.log('📈 Applying sort:', { sortBy, sortOrder: sortOrder ? 'desc' : 'asc' });
    query = query.order(sortBy, { ascending: !sortOrder });

    // Apply pagination
    query = query.range(offset, offset + validatedLimit - 1);

    // Execute the query
    console.log('🚀 Executing bookings query...');
    const { data: bookings, error, count } = await query;

    if (error) {
      console.error('❌ Database query error:', error);
      throw new Error(`Failed to fetch bookings: ${error.message}`);
    }

    if (!bookings) {
      console.warn('⚠️ No bookings data returned');
      return {
        bookings: [],
        pagination: {
          total: 0,
          page: validatedPage,
          limit: validatedLimit,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false
        }
      };
    }

    // Calculate pagination metadata (matching your pattern)
    const totalRecords = count || 0;
    const totalPages = Math.ceil(totalRecords / validatedLimit);
    const hasNextPage = validatedPage < totalPages;
    const hasPreviousPage = validatedPage > 1;

    console.log('✅ Bookings query successful:', {
      bookingsCount: bookings.length,
      totalRecords,
      totalPages,
      currentPage: validatedPage,
      hasNextPage,
      hasPreviousPage
    });

    // Process bookings data to ensure consistency (matching your pattern)
    const processedBookings = bookings.map(booking => ({
      ...booking,
      // Ensure amounts are properly formatted
      total_amount: booking.total_amount ? parseFloat(booking.total_amount) : 0,
      discount_amount: booking.discount_amount ? parseFloat(booking.discount_amount) : 0,
      commission_earned: booking.commission_earned ? parseFloat(booking.commission_earned) : 0,
      // Format dates consistently
      created_at: booking.created_at ? new Date(booking.created_at).toISOString() : null,
      updated_at: booking.updated_at ? new Date(booking.updated_at).toISOString() : null,
      // Ensure status is consistent
      status: booking.status ? booking.status.toLowerCase() : 'pending'
    }));

    // Return structured response (matching your pattern)
    return {
      bookings: processedBookings,
      pagination: {
        total: totalRecords,
        page: validatedPage,
        limit: validatedLimit,
        totalPages,
        hasNextPage,
        hasPreviousPage,
        offset
      },
      filters: {
        ...filters,
        applied: Object.keys(filters).filter(key => 
          filters[key] !== undefined && 
          filters[key] !== null && 
          filters[key] !== ''
        )
      },
      metadata: {
        queryTime: new Date().toISOString(),
        resultsCount: processedBookings.length
      }
    };

  } catch (error) {
    console.error('❌ AdminService - Error in getAllBookings:', error);
    
    // Provide more specific error messages (matching your pattern)
    if (error.message.includes('permission')) {
      throw new Error('Insufficient permissions to access bookings data');
    }
    
    if (error.message.includes('connection')) {
      throw new Error('Database connection error. Please try again.');
    }
    
    if (error.message.includes('timeout')) {
      throw new Error('Query timeout. Please try with more specific filters.');
    }
    
    // Re-throw with original message if it's already descriptive
    throw error;
  }
}

async getBookingDetails(bookingId) {
  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`
        *,
        users(id, email, first_name, last_name, phone, created_at),
        partners(id, business_name, email, phone, address),
        passengers(*),
        payments(
          id, 
          amount, 
          status, 
          payment_method, 
          transaction_id, 
          processed_at,
          created_at,
          updated_at
        ),
        seat_selections(
          id,
          seat_number,
          seat_class,
          extra_cost,
          passenger_id
        ),
        baggage_selections(
          id,
          baggage_type,
          weight_kg,
          extra_cost,
          passenger_id
        )
      `)
      .eq('id', bookingId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Booking not found');
      }
      throw error;
    }

    return booking;
  } catch (error) {
    console.error('Error in getBookingDetails service:', error);
    throw error;
  }
}

  async updateSystemSettings(settings) {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .upsert({
          id: 1, // Assuming single row for system settings
          ...settings,
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      return { settings: data, message: 'System settings updated successfully' };
    } catch (error) {
      throw error;
    }
  }

  async getSystemSettings() {
    try {
      const { data: settings, error } = await supabase
        .from('system_settings')
        .select('*')
        .eq('id', 1)
        .single();

      if (error) throw error;

      return settings;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = AdminService;