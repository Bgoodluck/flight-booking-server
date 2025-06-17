const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/emailService');
const { generateOTP } = require('../utils/otpService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class PartnerService {
  

  async registerPartner(partnerData) {
    try {
      const { 
        email, 
        password, 
        firstName, 
        lastName, 
        phone, 
        businessType, 
        companyName,
        // New optional fields
        address,
        city,
        state,
        country,
        postalCode,
        website,
        description
      } = partnerData;
      
      console.log('🚀 Starting partner registration for:', email);
      
      // Step 1: Enhanced validation
      if (!email || !password || !firstName || !lastName || !companyName) {
        throw new Error('Missing required fields: email, password, firstName, lastName, companyName are required');
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Invalid email format');
      }

      // Validate password strength
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }

      // Validate business name
      if (companyName.trim().length < 2) {
        throw new Error('Company name must be at least 2 characters long');
      }

      // Validate website URL if provided
      if (website && website.trim()) {
        const urlRegex = /^https?:\/\/.+/;
        if (!urlRegex.test(website.trim())) {
          throw new Error('Website must be a valid URL starting with http:// or https://');
        }
      }

      // Step 2: Check if user already exists in auth.users
      console.log('🔍 Checking for existing user...');
      const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
      
      if (listError) {
        console.error('Error checking existing users:', listError);
        // Continue anyway, Supabase will handle duplicate detection
      } else {
        const userExists = existingUsers.users.find(user => user.email === email.toLowerCase());
        if (userExists) {
          throw new Error('User with this email already exists');
        }
      }

      // Step 3: Check if partner already exists in custom table
      console.log('🔍 Checking partners table...');
      const { data: existingPartner, error: partnerCheckError } = await supabase
        .from('partners')
        .select('email')
        .eq('email', email.toLowerCase().trim())
        .single();

      if (existingPartner) {
        throw new Error('Partner with this email already exists');
      }

      // Generate OTP for verification
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      // Step 4: Create user in Supabase Auth
      console.log('🔐 Creating user in Supabase Auth...');
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: email.toLowerCase().trim(),
        password,
        email_confirm: false,
        user_metadata: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone ? phone.trim() : null,
        }
      });

      if (authError) {
        console.error('❌ Supabase Auth error:', authError);
        
        if (authError.message.includes('already registered') || 
            authError.message.includes('already exists') ||
            authError.code === 'user_already_exists') {
          throw new Error('User with this email already exists');
        }
        
        if (authError.message.includes('weak password') || 
            authError.code === 'weak_password') {
          throw new Error('Password is too weak. Please use a stronger password.');
        }
        
        if (authError.message.includes('invalid email') || 
            authError.code === 'invalid_email') {
          throw new Error('Invalid email address format');
        }
        
        throw new Error(`Registration failed: ${authError.message}`);
      }

      if (!authUser || !authUser.user) {
        throw new Error('Failed to create partner account');
      }

      console.log('✅ Auth user created successfully:', authUser.user.id);

      // Step 5: Create partner record in custom partners table with new fields
      console.log('🔧 Creating partner profile in custom table...');
      
      const partnerProfileData = {
        id: authUser.user.id,
        email: email.toLowerCase().trim(),
        password: 'hashed_by_supabase_auth',
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        business_name: companyName.trim(),
        contact_person: `${firstName.trim()} ${lastName.trim()}`,
        phone: phone ? phone.trim() : null,
        business_type: businessType,
        business_registration: 'PENDING',
        
        // New fields
        address: address ? address.trim() : null,
        city: city ? city.trim() : null,
        state: state ? state.trim() : null,
        country: country ? country.trim() : null,
        postal_code: postalCode ? postalCode.trim() : null,
        website: website ? website.trim() : null,
        description: description ? description.trim() : null,
        
        // Existing fields
        email_verified: false,
        role: 'partner',
        status: 'pending',
        commission_rate: 0.01,
        auth_provider: 'supabase',
        available_balance: 0,
        total_earnings: 0,
        otp: otp,
        otp_expiry: otpExpiry.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: partnerProfile, error: partnerError } = await supabase
        .from('partners')
        .insert(partnerProfileData)
        .select()
        .single();

      if (partnerError) {
        console.error('❌ Partner profile creation failed:', partnerError);
        
        // Clean up auth user if profile creation fails
        try {
          console.log('🧹 Cleaning up auth user due to profile creation failure...');
          await supabase.auth.admin.deleteUser(authUser.user.id);
        } catch (cleanupError) {
          console.error('❌ Failed to cleanup auth user:', cleanupError);
        }
        
        if (partnerError.code === '23505') {
          throw new Error('Partner with this email already exists');
        }
        
        if (partnerError.code === '23503') {
          throw new Error('Database constraint error. Please contact support.');
        }
        
        throw new Error(`Partner profile creation failed: ${partnerError.message}`);
      }

      console.log('✅ Partner profile created successfully');

      // Step 6: Send verification email
      try {
        await sendEmail({
          to: email.toLowerCase(),
          subject: 'Verify your Elevatio Partner Account',
          template: 'partner-email-verification',
          data: { 
            firstName, 
            otp, 
            businessName: companyName 
          }
        });
        console.log('✅ Verification email sent successfully');
      } catch (emailError) {
        console.error('⚠️ Failed to send verification email:', emailError);
      }

      // Step 7: Send admin notification
      try {
        if (process.env.ADMIN_EMAIL) {
          await sendEmail({
            to: process.env.ADMIN_EMAIL,
            subject: 'New Partner Registration',
            template: 'partner-registration-notification',
            data: { 
              businessName: companyName, 
              contactPerson: `${firstName} ${lastName}`, 
              email,
              registrationDate: new Date().toLocaleDateString(),
              city: city || 'Not specified',
              country: country || 'Not specified'
            }
          });
          console.log('✅ Admin notification sent');
        }
      } catch (emailError) {
        console.warn('⚠️ Failed to send admin notification:', emailError);
      }

      console.log('🎉 Partner registration completed successfully');

      return { 
        partner: this.sanitizePartner(partnerProfile), 
        message: 'Registration successful! Please check your email for verification code.' 
      };
      
    } catch (error) {
      console.error('❌ Partner registration error:', error);
      throw error;
    }
  }

  // Helper method to sanitize partner data before sending to client
  sanitizePartner(partner) {
    const { password, otp, otp_expiry, ...sanitizedPartner } = partner;
    return sanitizedPartner;
  }

  async loginPartner(email, password) {
    try {
      console.log('🔐 Starting partner login for:', email);
      
      // Step 1: Authenticate with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password
      });

      if (authError) {
        console.error('❌ Auth error:', authError);
        if (authError.message.includes('Invalid login credentials')) {
          throw new Error('Invalid email or password');
        }
        if (authError.message.includes('Email not confirmed')) {
          throw new Error('Please verify your email first');
        }
        throw new Error(`Login failed: ${authError.message}`);
      }

      console.log('✅ Auth successful, fetching partner profile for ID:', authData.user.id);

      // Step 2: Fetch partner profile from custom table
      const { data: partnerProfile, error: partnerError } = await supabase
        .from('partners')
        .select('*')
        .eq('id', authData.user.id)
        .single();

      if (partnerError) {
        console.error('❌ Partner profile fetch error:', partnerError);
        
        if (partnerError.code === 'PGRST116') {
          throw new Error('Partner profile not found. Please register as a partner first.');
        }
        
        throw new Error('Failed to fetch partner profile');
      }

      if (!partnerProfile) {
        throw new Error('Partner profile not found');
      }

      console.log('✅ Partner profile found:', partnerProfile.email);

      // Step 3: Check partner-specific conditions
      if (partnerProfile.status === 'rejected') {
        throw new Error('Account has been rejected. Please contact support.');
      }
      
      if (partnerProfile.status === 'suspended') {
        throw new Error('Account is suspended. Please contact support.');
      }
      
      if (partnerProfile.status === 'pending') {
        throw new Error('Account is pending approval. Please contact support.');
      }

      if (!partnerProfile.email_verified) {
        throw new Error('Please verify your email address first.');
      }

      // Step 4: Update last login
      await supabase
        .from('partners')
        .update({ 
          last_login: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', partnerProfile.id);

      // Step 5: Generate custom JWT
      const customToken = jwt.sign(
        { 
          userId: partnerProfile.id, 
          role: partnerProfile.role,
          email: partnerProfile.email 
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log('✅ Login successful for partner:', partnerProfile.business_name);

      return {
        token: customToken,
        supabaseToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        partner: this.sanitizePartner(partnerProfile)
      };
      
    } catch (error) {
      console.error('❌ Partner login error:', error);
      throw error;
    }
  }

  async verifyEmail(email, otp) {
    try {
      console.log('🔍 Verifying partner email with:', { email, otp });
      
      // Get partner with matching email and OTP
      const { data: partner, error } = await supabase
        .from('partners')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .eq('otp', otp)
        .single();
      
      if (error || !partner) {
        console.error('❌ Partner not found or invalid OTP:', error);
        throw new Error('Invalid verification code');
      }
      
      // Check if OTP has expired
      const now = new Date();
      const otpExpiryDate = new Date(partner.otp_expiry);
      
      if (now > otpExpiryDate) {
        throw new Error('Verification code has expired. Please request a new one.');
      }

      // Update Supabase Auth to confirm email
      console.log('🔧 Updating Supabase Auth email confirmation...');
      const { error: authError } = await supabase.auth.admin.updateUserById(partner.id, {
        email_confirm: true
      });
      
      if (authError) {
        console.error('❌ Auth update error:', authError);
        throw new Error('Failed to confirm email in authentication system');
      }

      // Update partner profile
      console.log('🔧 Updating partner profile...');
      const { error: updateError } = await supabase
        .from('partners')
        .update({
          email_verified: true,
          otp: null,
          otp_expiry: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', partner.id);
      
      if (updateError) {
        console.error('❌ Partner update error:', updateError);
        throw new Error('Failed to update verification status');
      }

      console.log('✅ Email verification completed successfully');
      return { message: 'Email verified successfully! Your account is now ready for approval.' };
      
    } catch (error) {
      console.error('❌ Email verification error:', error);
      throw error;
    }
  }

  async resendVerificationEmail(email) {
    try {
      console.log('📧 Resending verification email for:', email);
      
      // Get partner details
      const { data: partner, error } = await supabase
        .from('partners')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .single();

      if (error || !partner) {
        throw new Error('Partner not found');
      }

      if (partner.email_verified) {
        throw new Error('Email is already verified');
      }

      // Generate new OTP
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Update partner with new OTP
      const { error: updateError } = await supabase
        .from('partners')
        .update({
          otp,
          otp_expiry: otpExpiry.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', partner.id);

      if (updateError) {
        throw new Error('Failed to generate new verification code');
      }

      // Send verification email
      await sendEmail({
        to: email.toLowerCase(),
        subject: 'Verify your Elevatio Partner Account',
        template: 'partner-email-verification',
        data: { 
          firstName: partner.first_name, 
          otp, 
          businessName: partner.business_name 
        }
      });

      console.log('✅ Verification email resent successfully');
      return { message: 'Verification email sent successfully' };
      
    } catch (error) {
      console.error('❌ Resend verification error:', error);
      throw error;
    }
  }

  async forgotPassword(email) {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase().trim(), {
        redirectTo: `${process.env.FRONTEND_URL}/reset-password`
      });

      if (error) {
        throw new Error(`Password reset failed: ${error.message}`);
      }

      return { message: 'Password reset email sent successfully' };
    } catch (error) {
      throw error;
    }
  }

  async resetPassword(accessToken, newPassword) {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      }, {
        accessToken
      });

      if (error) {
        throw new Error(`Password reset failed: ${error.message}`);
      }

      return { message: 'Password updated successfully' };
    } catch (error) {
      throw error;
    }
  }

  async getPartnerDashboard(partnerId) {
  try {
    console.log(`Fetching dashboard for partner: ${partnerId}`);

    // Get partner basic info
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('available_balance, total_earnings, commission_rate, business_name')
      .eq('id', partnerId)
      .single();

    if (partnerError) throw partnerError;

    // Get partner bookings with commission data
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id,
        booking_reference,
        total_amount,
        commission_earned,
        status,
        created_at,
        flight_offer,
        passengers(first_name, last_name)
      `)
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false });

    if (bookingsError) throw bookingsError;

    // Get payout history
    const { data: payouts, error: payoutsError } = await supabase
      .from('payouts')
      .select('*')
      .eq('partner_id', partnerId)
      .order('requested_at', { ascending: false })
      .limit(5);

    if (payoutsError) throw payoutsError;

    // Get commission history
    const { data: commissions, error: commissionsError } = await supabase
      .from('partner_commissions')
      .select('*')
      .eq('partner_id', partnerId)
      .order('earned_at', { ascending: false })
      .limit(10);

    if (commissionsError) {
      console.warn('Failed to fetch commission history:', commissionsError);
    }

    // Calculate statistics
    const totalBookings = bookings.length;
    const totalCommissionEarned = bookings.reduce((sum, booking) => sum + (booking.commission_earned || 0), 0);
    const totalPayoutsRequested = payouts.reduce((sum, payout) => sum + payout.amount, 0);
    
    // Monthly statistics
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    
    const monthlyBookings = bookings.filter(b => 
      new Date(b.created_at) >= currentMonth
    );
    
    const monthlyCommission = monthlyBookings.reduce((sum, booking) => sum + (booking.commission_earned || 0), 0);
    const monthlyBookingCount = monthlyBookings.length;

    // Pending payouts
    const pendingPayouts = payouts.filter(p => p.status === 'pending');
    const pendingPayoutAmount = pendingPayouts.reduce((sum, payout) => sum + payout.amount, 0);

    return {
      partner: {
        business_name: partner.business_name,
        commission_rate: partner.commission_rate,
        available_balance: partner.available_balance || 0,
        total_earnings: partner.total_earnings || 0
      },
      statistics: {
        totalBookings,
        totalCommissionEarned,
        totalPayoutsRequested,
        monthlyBookingCount,
        monthlyCommission,
        pendingPayoutAmount,
        pendingPayoutCount: pendingPayouts.length
      },
      recentBookings: bookings.slice(0, 10),
      recentPayouts: payouts,
      recentCommissions: commissions || []
    };
    
  } catch (error) {
    console.error('Dashboard fetch error:', error);
    throw error;
  }
}
  async getPartnerBookings(partnerId) {
    try {
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select(`
          *,
          passengers(*),
          payments(*),
          seat_selections(*),
          baggage_selections(*)
        `)
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Process flight_offer JSON data for easier frontend consumption
      const processedBookings = bookings.map(booking => ({
        ...booking,
        flight_info: booking.flight_offer ? {
          departure: booking.flight_offer.itineraries?.[0]?.segments?.[0]?.departure || null,
          arrival: booking.flight_offer.itineraries?.[0]?.segments?.slice(-1)[0]?.arrival || null,
          airline: booking.flight_offer.itineraries?.[0]?.segments?.[0]?.carrierCode || null,
          flight_number: booking.flight_offer.itineraries?.[0]?.segments?.[0]?.number || null,
          duration: booking.flight_offer.itineraries?.[0]?.duration || null
        } : null
      }));

      return processedBookings;
    } catch (error) {
      console.error('Get partner bookings error:', error);
      throw error;
    }
  }

 async requestPayout(partnerId, amount) {
  try {
    console.log(`Processing payout request: Partner ${partnerId}, Amount: ${amount}`);

    // Validate amount
    if (!amount || amount <= 0) {
      throw new Error('Invalid payout amount');
    }

    // Set minimum payout amount (e.g., $10 equivalent)
    const minimumPayout = 10;
    if (amount < minimumPayout) {
      throw new Error(`Minimum payout amount is $${minimumPayout}`);
    }

    // Check partner and available balance
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('available_balance, total_earnings, email, first_name, last_name, business_name')
      .eq('id', partnerId)
      .single();

    if (partnerError) {
      console.error('Error fetching partner:', partnerError);
      throw new Error('Partner not found');
    }

    if (!partner) {
      throw new Error('Partner not found');
    }

    const availableBalance = parseFloat(partner.available_balance) || 0;
    const requestedAmount = parseFloat(amount);

    console.log(`Current available balance: ${availableBalance}`);

    if (availableBalance < requestedAmount) {
      throw new Error(`Insufficient balance. Available: $${availableBalance.toFixed(2)}, Requested: $${requestedAmount.toFixed(2)}`);
    }

    // Check for existing pending payouts
    const { data: pendingPayouts, error: pendingError } = await supabase
      .from('payouts')
      .select('id, amount')
      .eq('partner_id', partnerId)
      .eq('status', 'pending');

    if (pendingError) {
      console.error('Error checking pending payouts:', pendingError);
      throw new Error('Failed to check pending payouts');
    }

    const totalPendingAmount = pendingPayouts?.reduce((sum, payout) => sum + parseFloat(payout.amount), 0) || 0;
    const effectiveAvailableBalance = availableBalance - totalPendingAmount;

    if (effectiveAvailableBalance < requestedAmount) {
      throw new Error(`Insufficient balance after pending payouts. Available: $${effectiveAvailableBalance.toFixed(2)}, Requested: $${requestedAmount.toFixed(2)}`);
    }

    // Calculate processing fee (if applicable)
    const processingFeeRate = 0.02; // 2% fee example
    const processingFee = parseFloat((requestedAmount * processingFeeRate).toFixed(2));
    const netAmount = parseFloat((requestedAmount - processingFee).toFixed(2));

    // Create payout request
    const { data: payout, error: payoutError } = await supabase
      .from('payouts')
      .insert({
        partner_id: partnerId,
        amount: requestedAmount,
        status: 'pending',
        requested_at: new Date().toISOString(),
        processing_fee: processingFee,
        net_amount: netAmount,
        notes: `Payout requested by ${partner.business_name}`
      })
      .select()
      .single();

    if (payoutError) {
      console.error('Error creating payout:', payoutError);
      throw new Error('Failed to create payout request');
    }

    console.log(`✅ Payout request created successfully. ID: ${payout.id}, Amount: $${requestedAmount}`);

    // Send notification email to partner
    try {
      await this.sendPayoutNotificationEmail(partner, payout);
    } catch (emailError) {
      console.warn('Failed to send payout notification email:', emailError);
    }

    return { 
      payout, 
      message: 'Payout request submitted successfully',
      available_balance: availableBalance,
      pending_amount: totalPendingAmount,
      effective_available_balance: effectiveAvailableBalance,
      payout_id: payout.id,
      processing_fee: processingFee,
      net_amount: netAmount
    };
    
  } catch (error) {
    console.error('Payout request error:', error);
    throw error;
  }
}

  // Helper method to send payout notification email
  async sendPayoutNotificationEmail(partner, payout) {
  try {
    if (!emailService || typeof emailService.sendEmail !== 'function') {
      console.warn('Email service not available');
      return;
    }

    await emailService.sendEmail({
      to: partner.email,
      subject: 'Payout Request Received',
      template: 'payout-notification',
      data: {
        partner_name: partner.first_name,
        business_name: partner.business_name,
        amount: payout.amount,
        payout_id: payout.id,
        requested_at: new Date(payout.requested_at).toLocaleDateString()
      }
    });
    
  } catch (error) {
    console.error('Error sending payout notification email:', error);
  }
}

// 7. Method to get commission history
async getPartnerCommissions(partnerId, limit = 50) {
  try {
    const { data: commissions, error } = await supabase
      .from('partner_commissions')
      .select(`
        *,
        bookings!inner(
          booking_reference,
          total_amount,
          status,
          created_at
        )
      `)
      .eq('partner_id', partnerId)
      .order('earned_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return commissions || [];
    
  } catch (error) {
    console.error('Error fetching partner commissions:', error);
    throw error;
  }
}


  async getPartnerProfile(partnerId) {
    try {
      // First get the partner data
      const { data: partner, error: partnerError } = await supabase
        .from('partners')
        .select('*')
        .eq('id', partnerId)
        .single();

      if (partnerError) {
        console.error('Error fetching partner:', partnerError);
        throw new Error('Failed to fetch partner profile');
      }

      if (!partner) {
        throw new Error('Partner not found');
      }

      // Get booking stats separately
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, booking_reference, total_amount, commission_earned, status, created_at')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (bookingsError) {
        console.warn('Error fetching bookings:', bookingsError);
        // Don't throw here, just set empty array
      }

      // Get payout history separately
      const { data: payouts, error: payoutsError } = await supabase
        .from('payouts')
        .select('id, amount, status, requested_at, processed_at')
        .eq('partner_id', partnerId)
        .order('requested_at', { ascending: false });

      if (payoutsError) {
        console.warn('Error fetching payouts:', payoutsError);
        // Don't throw here, just set empty array
      }

      // Combine the data
      const profileData = {
        ...partner,
        bookings: bookings || [],
        payouts: payouts || []
      };

      return this.sanitizePartner(profileData);
    } catch (error) {
      console.error('Get partner profile error:', error);
      throw error;
    }
  }

  // Helper method to upload profile image
async uploadProfileImage(file, partnerId) {
  try {
    // Validate file
    if (!file || !file.buffer) {
      throw new Error('No file or file buffer provided');
    }

    // Check file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new Error('File size must be less than 5MB');
    }

    // Check file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new Error('Only JPEG, PNG, and WebP images are allowed');
    }

    // Generate unique filename
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${partnerId}_${Date.now()}.${fileExt}`;
    const filePath = `profiles/${fileName}`;

    console.log('Uploading file to path:', filePath);
    console.log('File details:', {
      size: file.size,
      type: file.mimetype,
      originalName: file.originalname
    });

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('profile-images')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Supabase upload error:', error);
      throw new Error(`Failed to upload image: ${error.message}`);
    }

    console.log('File uploaded successfully:', data);

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('profile-images')
      .getPublicUrl(filePath);

    console.log('Public URL generated:', publicUrl);

    // Delete old profile image if it exists
    try {
      const { data: currentPartner } = await supabase
        .from('partners')
        .select('profile_image')
        .eq('id', partnerId)
        .single();

      if (currentPartner?.profile_image) {
        // Extract file path from old URL
        const urlParts = currentPartner.profile_image.split('/');
        const oldFilePath = urlParts.slice(-2).join('/'); // Get 'profiles/filename.ext'
        
        if (oldFilePath !== filePath && oldFilePath.startsWith('profiles/')) {
          const { error: deleteError } = await supabase.storage
            .from('profile-images')
            .remove([oldFilePath]);
            
          if (deleteError) {
            console.warn('Failed to delete old image:', deleteError);
          } else {
            console.log('Old profile image deleted:', oldFilePath);
          }
        }
      }
    } catch (deleteError) {
      console.warn('Failed to delete old profile image:', deleteError);
      // Don't throw here, it's not critical
    }

    return publicUrl;
  } catch (error) {
    console.error('Image upload error:', error);
    throw error;
  }
}

  // Enhanced updatePartnerProfile method with proper file handling
 async updatePartnerProfile(partnerId, updateData, file = null) {
  try {
    // Map frontend field names to database field names
    const dbUpdateData = {};
    
    // Handle name fields mapping
    if (updateData.firstName !== undefined) {
      dbUpdateData.first_name = updateData.firstName;
    }
    if (updateData.lastName !== undefined) {
      dbUpdateData.last_name = updateData.lastName;
    }
    if (updateData.companyName !== undefined) {
      dbUpdateData.business_name = updateData.companyName;
    }
    
    // Handle other fields
    if (updateData.phone !== undefined) {
      dbUpdateData.phone = updateData.phone;
    }
    if (updateData.businessType !== undefined) {
      dbUpdateData.business_type = updateData.businessType;
    }
    if (updateData.address !== undefined) {
      dbUpdateData.address = updateData.address;
    }
    if (updateData.city !== undefined) {
      dbUpdateData.city = updateData.city;
    }
    if (updateData.state !== undefined) {
      dbUpdateData.state = updateData.state;
    }
    if (updateData.country !== undefined) {
      dbUpdateData.country = updateData.country;
    }
    if (updateData.postalCode !== undefined) {
      dbUpdateData.postal_code = updateData.postalCode;
    }
    if (updateData.website !== undefined) {
      dbUpdateData.website = updateData.website;
    }
    if (updateData.description !== undefined) {
      dbUpdateData.description = updateData.description;
    }

    // Handle profile image upload - ONLY if file is provided
    if (file && file.buffer) {
      console.log('Processing profile image upload...');
      try {
        const imageUrl = await this.uploadProfileImage(file, partnerId);
        dbUpdateData.profile_image = imageUrl;
        console.log('Profile image uploaded successfully:', imageUrl);
      } catch (imageError) {
        console.error('Failed to upload profile image:', imageError);
        // Don't fail the entire update if image upload fails
        // You can choose to throw here if image upload is critical
      }
    }
    
    // Add timestamp
    dbUpdateData.updated_at = new Date().toISOString();
    
    console.log('Updating partner profile with data:', {
      ...dbUpdateData,
      profile_image: dbUpdateData.profile_image ? 'URL_PRESENT' : 'NO_IMAGE'
    });
    
    const { data: partner, error } = await supabase
      .from('partners')
      .update(dbUpdateData)
      .eq('id', partnerId)
      .select()
      .single();

    if (error) {
      console.error('Database update error:', error);
      throw new Error('Failed to update partner profile');
    }

    console.log('Partner profile updated successfully');

    // Update auth metadata if needed
    if (updateData.firstName || updateData.lastName || updateData.phone || updateData.companyName) {
      try {
        const metadataUpdate = {
          first_name: updateData.firstName || partner.first_name,
          last_name: updateData.lastName || partner.last_name,
          phone: updateData.phone || partner.phone,
          business_name: updateData.companyName || partner.business_name,
        };
        
        // Only add profile_image to metadata if it was updated
        if (partner.profile_image) {
          metadataUpdate.profile_image = partner.profile_image;
        }
        
        await supabase.auth.admin.updateUserById(partnerId, {
          user_metadata: metadataUpdate
        });
        
        console.log('Auth metadata updated successfully');
      } catch (metadataError) {
        console.warn('Failed to update auth metadata:', metadataError);
        // Don't fail the whole operation if metadata update fails
      }
    }

    return this.sanitizePartner(partner);
  } catch (error) {
    console.error('Update partner profile error:', error);
    throw error;
  }
}

// async calculateAndStoreCommission(bookingId, partnerId, totalAmount) {
//   try {
//     console.log(`Calculating commission for booking ${bookingId}, partner ${partnerId}, amount ${totalAmount}`);

//     // Validate inputs
//     if (!bookingId || !partnerId || !totalAmount || totalAmount <= 0) {
//       throw new Error('Invalid parameters for commission calculation');
//     }

//     // Get partner's commission rate and current balances
//     const { data: partner, error: partnerError } = await supabase
//       .from('partners')
//       .select('commission_rate, available_balance, total_earnings, business_name')
//       .eq('id', partnerId)
//       .single();

//     if (partnerError || !partner) {
//       console.error('Partner fetch error:', partnerError);
//       throw new Error(`Partner not found for commission calculation: ${partnerId}`);
//     }

//     // Calculate commission
//     const commissionRate = partner.commission_rate || 0.01; // Default 1%
//     const commissionAmount = parseFloat((totalAmount * commissionRate).toFixed(2));

//     console.log(`Commission calculation: ${totalAmount} × ${commissionRate} = ${commissionAmount}`);

//     // Check if commission already exists for this booking
//     const { data: existingCommission, error: existingError } = await supabase
//       .from('partner_commissions')
//       .select('id')
//       .eq('booking_id', bookingId)
//       .eq('partner_id', partnerId)
//       .single();

//     if (existingCommission) {
//       console.warn(`Commission already exists for booking ${bookingId}, skipping...`);
//       return {
//         commissionAmount,
//         commissionRate,
//         message: 'Commission already exists'
//       };
//     }

//     // Start transaction-like operations
//     try {
//       // 1. Update booking with commission information
//       const { error: bookingUpdateError } = await supabase
//         .from('bookings')
//         .update({
//           commission_earned: commissionAmount,
//           commission_rate: commissionRate,
//           partner_id: partnerId, // Ensure partner_id is set
//           updated_at: new Date().toISOString()
//         })
//         .eq('id', bookingId);

//       if (bookingUpdateError) {
//         throw new Error(`Failed to update booking commission: ${bookingUpdateError.message}`);
//       }

//       // 2. Store commission record first
//       const { error: commissionRecordError } = await supabase
//         .from('partner_commissions')
//         .insert({
//           partner_id: partnerId,
//           booking_id: bookingId,
//           amount: commissionAmount,
//           commission_rate: commissionRate,
//           booking_amount: totalAmount,
//           status: 'earned',
//           earned_at: new Date().toISOString(),
//           created_at: new Date().toISOString()
//         });

//       if (commissionRecordError) {
//         console.error('Commission record creation error:', commissionRecordError);
//         throw new Error(`Failed to create commission record: ${commissionRecordError.message}`);
//       }

//       // 3. Update partner's total earnings and available balance
//       const newTotalEarnings = (parseFloat(partner.total_earnings) || 0) + commissionAmount;
//       const newAvailableBalance = (parseFloat(partner.available_balance) || 0) + commissionAmount;

//       const { error: partnerUpdateError } = await supabase
//         .from('partners')
//         .update({
//           total_earnings: newTotalEarnings,
//           available_balance: newAvailableBalance,
//           updated_at: new Date().toISOString()
//         })
//         .eq('id', partnerId);

//       if (partnerUpdateError) {
//         console.error('Partner update error:', partnerUpdateError);
        
//         // Try to rollback commission record
//         await supabase
//           .from('partner_commissions')
//           .delete()
//           .eq('booking_id', bookingId)
//           .eq('partner_id', partnerId);
        
//         throw new Error(`Failed to update partner earnings: ${partnerUpdateError.message}`);
//       }

//       console.log(`✅ Commission processed successfully: ${commissionAmount} added to partner ${partnerId} (${partner.business_name})`);
//       console.log(`✅ Partner new totals - Earnings: ${newTotalEarnings}, Available: ${newAvailableBalance}`);

//       return {
//         commissionAmount,
//         commissionRate,
//         newTotalEarnings,
//         newAvailableBalance,
//         partnerName: partner.business_name
//       };

//     } catch (transactionError) {
//       console.error('Transaction error during commission calculation:', transactionError);
//       throw transactionError;
//     }

//   } catch (error) {
//     console.error('Commission calculation error:', error);
//     throw error;
//   }
// }

async calculateAndStoreCommission(bookingId, partnerId, totalAmount) {
  try {
    console.log(`Calculating commission for booking ${bookingId}, partner ${partnerId}, amount ${totalAmount}`);

    // Validate inputs
    if (!bookingId || !partnerId || !totalAmount || totalAmount <= 0) {
      throw new Error('Invalid parameters for commission calculation');
    }

    // Get partner's commission rate and current balances
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('commission_rate, available_balance, total_earnings, business_name')
      .eq('id', partnerId)
      .single();

    if (partnerError || !partner) {
      console.error('Partner fetch error:', partnerError);
      throw new Error(`Partner not found for commission calculation: ${partnerId}`);
    }

    // Calculate commission
    const commissionRate = partner.commission_rate || 0.01; // Default 1%
    const commissionAmount = parseFloat((totalAmount * commissionRate).toFixed(2));

    console.log(`Commission calculation: ${totalAmount} × ${commissionRate} = ${commissionAmount}`);

    // Check if commission already exists for this booking
    const { data: existingCommission, error: existingError } = await supabase
      .from('partner_commissions')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('partner_id', partnerId)
      .single();

    if (existingCommission) {
      console.warn(`Commission already exists for booking ${bookingId}, skipping...`);
      return {
        commissionAmount,
        commissionRate,
        message: 'Commission already exists'
      };
    }

    // Start transaction-like operations
    try {
      // 1. Update booking with commission information
      const { error: bookingUpdateError } = await supabase
        .from('bookings')
        .update({
          commission_earned: commissionAmount,
          commission_rate: commissionRate,
          partner_id: partnerId, // Ensure partner_id is set
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (bookingUpdateError) {
        throw new Error(`Failed to update booking commission: ${bookingUpdateError.message}`);
      }

      // 2. Store commission record - FIXED: Use correct column names
      const { error: commissionRecordError } = await supabase
        .from('partner_commissions')
        .insert({
          partner_id: partnerId,
          booking_id: bookingId,
          commission_amount: commissionAmount,  // ✅ Fixed: was 'amount'
          commission_rate: commissionRate,
          status: 'earned',
          earned_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        });

      if (commissionRecordError) {
        console.error('Commission record creation error:', commissionRecordError);
        throw new Error(`Failed to create commission record: ${commissionRecordError.message}`);
      }

      // 3. Update partner's total earnings and available balance
      const newTotalEarnings = (parseFloat(partner.total_earnings) || 0) + commissionAmount;
      const newAvailableBalance = (parseFloat(partner.available_balance) || 0) + commissionAmount;

      const { error: partnerUpdateError } = await supabase
        .from('partners')
        .update({
          total_earnings: newTotalEarnings,
          available_balance: newAvailableBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', partnerId);

      if (partnerUpdateError) {
        console.error('Partner update error:', partnerUpdateError);
        
        // Try to rollback commission record
        await supabase
          .from('partner_commissions')
          .delete()
          .eq('booking_id', bookingId)
          .eq('partner_id', partnerId);
        
        throw new Error(`Failed to update partner earnings: ${partnerUpdateError.message}`);
      }

      console.log(`✅ Commission processed successfully: ${commissionAmount} added to partner ${partnerId} (${partner.business_name})`);
      console.log(`✅ Partner new totals - Earnings: ${newTotalEarnings}, Available: ${newAvailableBalance}`);

      return {
        commissionAmount,
        commissionRate,
        newTotalEarnings,
        newAvailableBalance,
        partnerName: partner.business_name
      };

    } catch (transactionError) {
      console.error('Transaction error during commission calculation:', transactionError);
      throw transactionError;
    }

  } catch (error) {
    console.error('Commission calculation error:', error);
    throw error;
  }
}

async getCommissionSummary(partnerId, startDate = null, endDate = null) {
  try {
    console.log(`Fetching commission summary for partner: ${partnerId}`, { startDate, endDate });

    // Build the base query
    let query = supabase
      .from('partner_commissions')
      .select(`
        *,
        bookings!inner(
          booking_reference,
          total_amount,
          status,
          created_at
        )
      `)
      .eq('partner_id', partnerId);

    // Apply date filters if provided
    if (startDate) {
      query = query.gte('earned_at', startDate);
    }
    if (endDate) {
      query = query.lte('earned_at', endDate);
    }

    const { data: commissions, error } = await query.order('earned_at', { ascending: false });

    if (error) {
      console.error('Error fetching commission summary:', error);
      throw error;
    }

    // Calculate summary statistics
    const totalCommissions = commissions.reduce((sum, commission) => sum + (commission.amount || 0), 0);
    const totalBookings = commissions.length;
    const averageRate = totalBookings > 0 
      ? commissions.reduce((sum, commission) => sum + (commission.commission_rate || 0), 0) / totalBookings
      : 0;

    // Group by status
    const statusCounts = commissions.reduce((acc, commission) => {
      const status = commission.status || 'earned';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    // Group by month for trend analysis
    const monthlyData = commissions.reduce((acc, commission) => {
      const month = new Date(commission.earned_at).toISOString().substring(0, 7); // YYYY-MM format
      if (!acc[month]) {
        acc[month] = { count: 0, amount: 0 };
      }
      acc[month].count += 1;
      acc[month].amount += commission.amount || 0;
      return acc;
    }, {});

    const summary = {
      totalCommissions,
      totalBookings,
      averageRate,
      statusBreakdown: statusCounts,
      monthlyBreakdown: monthlyData,
      dateRange: {
        startDate,
        endDate,
        totalDays: startDate && endDate 
          ? Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24))
          : null
      }
    };

    console.log('Commission summary calculated:', summary);
    return summary;

  } catch (error) {
    console.error('Error fetching commission summary:', error);
    throw error;
  }
}

  async getPartnerPayouts(partnerId) {
  try {
    const { data: payouts, error } = await supabase
      .from('payouts')
      .select(`
        *,
        partners!inner(business_name, email)
      `)
      .eq('partner_id', partnerId)
      .order('requested_at', { ascending: false });

    if (error) {
      console.error('Error fetching payouts:', error);
      throw new Error('Failed to fetch payout history');
    }

    return payouts || [];
  } catch (error) {
    console.error('Get partner payouts error:', error);
    throw error;
  }
}


  async getPayoutDetails(partnerId, payoutId) {
  try {
    const { data: payout, error } = await supabase
      .from('payouts')
      .select(`
        *,
        partners!inner(business_name, email, first_name, last_name)
      `)
      .eq('partner_id', partnerId)
      .eq('id', payoutId)
      .single();

    if (error) {
      console.error('Error fetching payout details:', error);
      throw new Error('Failed to fetch payout details');
    }

    if (!payout) {
      throw new Error('Payout not found');
    }

    return payout;
  } catch (error) {
    console.error('Get payout details error:', error);
    throw error;
  }
}

  async syncPartnerWithAuth(partnerId) {
    try {
      const { data: authPartner } = await supabase.auth.admin.getUserById(partnerId);
      
      if (authPartner.user) {
        await supabase
          .from('partners')
          .update({
            email_verified: authPartner.user.email_confirmed_at ? true : false,
            last_login: authPartner.user.last_sign_in_at,
            updated_at: new Date().toISOString()
          })
          .eq('id', partnerId);
      }
    } catch (error) {
      console.error('Sync error:', error);
    }
  }


async approvePartner(partnerId) {
  try {
    // Update partner status to approved
    const { data: partner, error } = await supabase
      .from('partners')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', partnerId)
      .select()
      .single();

    if (error) {
      console.error('Partner approval error:', error);
      throw new Error('Failed to approve partner');
    }

    // Send approval notification email (if email service is available)
    try {
      if (typeof sendEmail === 'function') {
        await sendEmail({
          to: partner.email,
          subject: 'Partner Account Approved',
          template: 'partner-approved',
          data: { 
            firstName: partner.first_name,
            businessName: partner.business_name 
          }
        });
        console.log('Approval email sent successfully');
      }
    } catch (emailError) {
      console.warn('Failed to send approval email:', emailError.message);
      // Don't throw here as the approval itself succeeded
    }

    return { 
      partner: this.sanitizePartner(partner),
      message: 'Partner approved successfully'
    };
  } catch (error) {
    console.error('Partner approval failed:', error.message);
    throw error;
  }
}

sanitizePartner(partner) {
  if (!partner) return null;
  
  const { password, otp, otp_expiry, ...sanitizedPartner } = partner;
  return sanitizedPartner;
}
  // Test database connection 
  async testConnection() {
    try {
      const { data, error } = await supabase
        .from('partners')
        .select('count(*)')
        .limit(1);
      
      if (error) {
        console.error('❌ Database connection test failed:', error);
        return false;
      }
      
      console.log('✅ Database connection test successful');
      return true;
    } catch (error) {
      console.error('❌ Database connection test error:', error);
      return false;
    }
  }
  async rejectPartner(partnerId, reason) {
    try {
      // Update partner status to rejected
      const { data: partner, error } = await supabase
        .from('partners')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', partnerId)
        .select()
        .single();

      if (error) {
        throw new Error('Failed to reject partner');
      }

      // Send rejection notification email
      try {
        await sendEmail({
          to: partner.email,
          subject: 'Partner Account Rejected',
          template: 'partner-rejected',
          data: { 
            firstName: partner.first_name,
            businessName: partner.business_name,
            reason 
          }
        });
        console.log('Rejection email sent successfully');
      } catch (emailError) {
        console.warn('Failed to send rejection email:', emailError.message);
        // Don't throw here as the rejection itself succeeded
      }

      return { 
        partner: this.sanitizePartner(partner),
        message: 'Partner rejected successfully'
      };
    } catch (error) {
      console.error('Partner rejection failed:', error.message);
      throw error;
    }
  }


  async getBookingDetails(partnerId, bookingId) {
  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`
        *,
        passengers(*),
        payments(*),
        seat_selections(*),
        baggage_selections(*)
      `)
      .eq('partner_id', partnerId)
      .eq('id', bookingId)
      .single();

    if (error) {
      console.error('Error fetching booking details:', error);
      throw new Error('Failed to fetch booking details');
    }

    if (!booking) {
      throw new Error('Booking not found');
    }

    // Process flight_offer JSON data for easier frontend consumption
    const processedBooking = {
      ...booking,
      flight_info: booking.flight_offer ? {
        departure: booking.flight_offer.itineraries?.[0]?.segments?.[0]?.departure || null,
        arrival: booking.flight_offer.itineraries?.[0]?.segments?.slice(-1)[0]?.arrival || null,
        airline: booking.flight_offer.itineraries?.[0]?.segments?.[0]?.carrierCode || null,
        flight_number: booking.flight_offer.itineraries?.[0]?.segments?.[0]?.number || null,
        duration: booking.flight_offer.itineraries?.[0]?.duration || null
      } : null
    };
    return processedBooking;
    } catch (error) {
    console.error('Get partner bookings error:', error);
    throw error;
  }
  }


  async recalculateAllCommissions(partnerId) {
  try {
    console.log(`Recalculating all commissions for partner: ${partnerId}`);

    // Get partner's commission rate
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('commission_rate, business_name')
      .eq('id', partnerId)
      .single();

    if (partnerError || !partner) {
      throw new Error(`Partner not found: ${partnerId}`);
    }

    // Get all bookings for this partner that need commission recalculation
    // Look for bookings where partner_id matches OR user_id matches (for backwards compatibility)
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, booking_reference, total_price, total_amount, commission_earned, status, user_id, partner_id')
      .or(`partner_id.eq.${partnerId},user_id.eq.${partnerId}`)
      .eq('status', 'confirmed')
      .or('commission_earned.is.null,commission_earned.eq.0'); // Get bookings with no commission

    if (bookingsError) {
      throw new Error(`Failed to fetch bookings: ${bookingsError.message}`);
    }

    if (!bookings || bookings.length === 0) {
      console.log('No bookings found that need commission recalculation');
      return { 
        message: 'No bookings to process', 
        updatedBookings: 0,
        partnerName: partner.business_name 
      };
    }

    console.log(`Found ${bookings.length} bookings to recalculate for ${partner.business_name}`);

    const commissionRate = partner.commission_rate || 0.01;
    let totalCommissionAdded = 0;
    let updatedBookings = 0;
    const processedBookings = [];

    // Process each booking
    for (const booking of bookings) {
      try {
        const bookingAmount = booking.total_price || booking.total_amount || 0;
        
        if (bookingAmount <= 0) {
          console.warn(`Skipping booking ${booking.booking_reference} - no valid amount`);
          continue;
        }

        const commissionAmount = parseFloat((bookingAmount * commissionRate).toFixed(2));
        
        // Check if commission record already exists
        const { data: existingCommission } = await supabase
          .from('partner_commissions')
          .select('id')
          .eq('booking_id', booking.id)
          .eq('partner_id', partnerId)
          .single();

        if (existingCommission) {
          console.log(`Commission already exists for booking ${booking.booking_reference}, skipping...`);
          continue;
        }

        // Update booking
        const { error: updateError } = await supabase
          .from('bookings')
          .update({
            commission_earned: commissionAmount,
            commission_rate: commissionRate,
            partner_id: partnerId, // Ensure partner_id is set
            updated_at: new Date().toISOString()
          })
          .eq('id', booking.id);

        if (updateError) {
          console.error(`Failed to update booking ${booking.booking_reference}:`, updateError);
          continue;
        }

        // Add commission record
        const { error: commissionError } = await supabase
          .from('partner_commissions')
          .insert({
            partner_id: partnerId,
            booking_id: booking.id,
            amount: commissionAmount,
            commission_rate: commissionRate,
            booking_amount: bookingAmount,
            status: 'earned',
            earned_at: new Date().toISOString(),
            created_at: new Date().toISOString()
          });

        if (commissionError) {
          console.error(`Failed to create commission record for booking ${booking.booking_reference}:`, commissionError);
          continue;
        }

        totalCommissionAdded += commissionAmount;
        updatedBookings++;
        processedBookings.push({
          bookingId: booking.id,
          bookingReference: booking.booking_reference,
          commissionAmount: commissionAmount
        });
        
        console.log(`✅ Updated booking ${booking.booking_reference}: +${commissionAmount} commission`);
        
      } catch (bookingError) {
        console.error(`Error processing booking ${booking.booking_reference}:`, bookingError);
      }
    }

    // Update partner's total earnings and available balance
    if (totalCommissionAdded > 0) {
      const { data: currentPartner, error: getCurrentPartnerError } = await supabase
        .from('partners')
        .select('total_earnings, available_balance')
        .eq('id', partnerId)
        .single();

      if (!getCurrentPartnerError && currentPartner) {
        const newTotalEarnings = (parseFloat(currentPartner.total_earnings) || 0) + totalCommissionAdded;
        const newAvailableBalance = (parseFloat(currentPartner.available_balance) || 0) + totalCommissionAdded;

        const { error: partnerUpdateError } = await supabase
          .from('partners')
          .update({
            total_earnings: newTotalEarnings,
            available_balance: newAvailableBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', partnerId);

        if (partnerUpdateError) {
          console.error('Failed to update partner totals:', partnerUpdateError);
        } else {
          console.log(`✅ Partner totals updated - Earnings: ${newTotalEarnings}, Available: ${newAvailableBalance}`);
        }
      }
    }

    console.log(`✅ Recalculation complete for ${partner.business_name}: ${updatedBookings} bookings updated, ${totalCommissionAdded} total commission added`);

    return {
      message: 'Commission recalculation completed',
      partnerName: partner.business_name,
      updatedBookings,
      totalCommissionAdded,
      commissionRate,
      processedBookings
    };

  } catch (error) {
    console.error('Commission recalculation error:', error);
    throw error;
  }
}


  /**
   * Add this method to trigger commission recalculation for existing data
   */
  async fixExistingCommissions(partnerId) {
    try {
      const result = await this.recalculateAllCommissions(partnerId);
      return result;
    } catch (error) {
      console.error('Fix existing commissions error:', error);
      throw error;
    }
  }


}

module.exports = PartnerService;