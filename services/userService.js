const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/emailService');
const { generateOTP } = require('../utils/otpService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class UserService {
  async registerUser(userData) {
  try {
    const { email, password, firstName, lastName, phone } = userData;
    
    console.log('Starting user registration for:', email);
    
    // Step 1: Validate input
    if (!email || !password || !firstName || !lastName) {
      throw new Error('Missing required fields');
    }
    
    // Step 2: Check if user already exists in auth.users
    const { data: existingAuthUser } = await supabase.auth.admin.listUsers();
    const userExists = existingAuthUser.users.find(user => user.email === email);
    
    if (userExists) {
      throw new Error('User with this email already exists');
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    // Step 3: Create user in Supabase Auth - WITHOUT OTP fields
    console.log('Creating user in Supabase Auth...');
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Set to false for email verification
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        custom_verification_required: true,
      }
    });

    if (authError) {
      console.error('Supabase Auth error:', authError);
      
      if (authError.message.includes('already registered') || 
          authError.message.includes('already exists')) {
        throw new Error('User with this email already exists');
      }
      
      throw new Error(`Registration failed: ${authError.message}`);
    }

    if (!authUser || !authUser.user) {
      throw new Error('Failed to create user');
    }

    console.log('Auth user created successfully:', authUser.user.id);

    // Step 4: Wait a moment for trigger to complete, then get user profile
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get the created user profile
    let userProfile;
    const { data: existingProfile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.user.id)
      .single();

    if (profileError) {
      console.error('Error fetching user profile:', profileError);
      // If profile wasn't created by trigger, create it manually
      const { data: manualProfile, error: manualError } = await supabase
        .from('users')
        .insert({
          id: authUser.user.id,
          email: email.toLowerCase(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone ? phone.trim() : null,
         email_verified: false, // Set to false initially
          role: 'user',
          status: 'active',
          auth_provider: 'supabase',
          otp: otp, // Store OTP in custom table
          otp_expiry: otpExpiry.toISOString()
        })
        .select()
        .single();

      if (manualError) {
        console.error('Manual profile creation failed:', manualError);
        throw new Error('Profile creation failed');
      }

      userProfile = manualProfile;
    } else {
      // Update the existing profile with OTP
      const { data: updatedProfile, error: updateError } = await supabase
        .from('users')
        .update({
          otp: otp,
          otp_expiry: otpExpiry.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', authUser.user.id)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating profile with OTP:', updateError);
        throw new Error('Failed to set verification code');
      }

      userProfile = updatedProfile;
    }

    // Step 5: Send verification email AFTER storing OTP
    try {
      await sendEmail({
        to: email,
        subject: 'Verify your Elevatio account',
        template: 'email-verification',
        data: { firstName, otp }
      });
      console.log('Verification email sent successfully');
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Don't throw here - user is created, just email failed
    }

    console.log('User profile retrieved successfully');

    return { 
      user: this.sanitizeUser(userProfile), 
      message: 'Registration successful! Please check your email for verification code.' 
    };
    
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
}

async loginUser(email, password) {
  try {
    // Step 1: Authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      if (authError.message.includes('Invalid login credentials')) {
        throw new Error('Invalid email or password');
      }
      if (authError.message.includes('Email not confirmed')) {
        throw new Error('Please verify your email first');
      }
      throw new Error(`Login failed: ${authError.message}`);
    }

    console.log('Auth successful, fetching user profile for ID:', authData.user.id);

    // Step 2: Use service role client to fetch user data (bypasses RLS)
    const serviceRoleSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: customUser, error: customError } = await serviceRoleSupabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (customError) {
      console.error('Custom user fetch error:', customError);
      
      // If user not found in custom table, create it from auth data
      if (customError.code === 'PGRST116') {
        console.log('Creating missing user profile...');
        const { data: newUser, error: createError } = await serviceRoleSupabase
          .from('users')
          .insert({
            id: authData.user.id,
            email: authData.user.email,
            first_name: authData.user.user_metadata?.first_name || '',
            last_name: authData.user.user_metadata?.last_name || '',
            phone: authData.user.user_metadata?.phone || null,
            email_verified: authData.user.email_confirmed_at ? true : false,
            role: 'user',
            status: 'active',
            auth_provider: 'supabase',
            created_at: authData.user.created_at,
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (createError) {
          console.error('Failed to create user profile:', createError);
          throw new Error('Failed to create user profile');
        }

        customUser = newUser;
      } else {
        throw new Error('User profile not found in database');
      }
    }

    if (!customUser) {
      console.error('No custom user found for ID:', authData.user.id);
      throw new Error('User profile not found');
    }

    console.log('User profile found:', customUser.email);
    

    // Step 3: Fetch related data (optional - handle missing tables gracefully)
    let userPreferences = null;
    let savedPassengers = null;

    try {
      const { data: preferences } = await serviceRoleSupabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', customUser.id);
      userPreferences = preferences || [];
    } catch (prefError) {
      console.log('user_preferences table not found or no data');
      userPreferences = [];
    }

    try {
      const { data: passengers } = await serviceRoleSupabase
        .from('saved_passengers')
        .select('*')
        .eq('user_id', customUser.id);
      savedPassengers = passengers || [];
    } catch (passError) {
      console.log('saved_passengers table not found or no data');
      savedPassengers = [];
    }

    // Step 4: Update last login
    await serviceRoleSupabase
      .from('users')
      .update({ 
        last_login: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', customUser.id);

    // Step 5: Generate custom JWT if needed
    const customToken = jwt.sign(
      { 
        userId: customUser.id, 
        role: customUser.role,
        email: customUser.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('Generated custom token:', customToken);
    // Combine user data with related data
    const userData = {
      ...customUser,
      user_preferences: userPreferences,
      saved_passengers: savedPassengers
    };

    return {
      token: customToken,
      supabaseToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      user: this.sanitizeUser(userData)
    };
  } catch (error) {
    console.error('Full login error:', error);
    throw error;
  }
}
  async loginWithSupabaseSession(supabaseAccessToken) {
    try {
      const { data: { user: authUser }, error } = await supabase.auth.getUser(supabaseAccessToken);
      
      if (error || !authUser) {
        throw new Error('Invalid session token');
      }

      const { data: customUser, error: customError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (customError || !customUser) {
        throw new Error('User profile not found');
      }

      return this.sanitizeUser(customUser);
    } catch (error) {
      throw error;
    }
  }

  async verifyEmail(email, otp) {
  try {
    console.log('Verifying email with:', { email, otp, currentTime: new Date().toISOString() });
    
    // Get user with matching email and OTP
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('otp', otp)
      .single();
    
    console.log('User found with matching OTP:', user);
    
    if (error) {
      console.error('Database error:', error);
      if (error.code === 'PGRST116') {
        throw new Error('Invalid OTP code');
      }
      throw new Error('Database error during OTP verification');
    }
    
    if (!user) {
      throw new Error('Invalid OTP code');
    }
    
    // Check if OTP has expired
    const now = new Date();
    const otpExpiryDate = new Date(user.otp_expiry);
    console.log('OTP expiry check:', { now: now.toISOString(), expiry: otpExpiryDate.toISOString(), expired: now > otpExpiryDate });
    
    if (now > otpExpiryDate) {
      throw new Error('OTP has expired. Please request a new verification code.');
    }

    // CRITICAL FIX: Update Supabase Auth to confirm email
    console.log('Updating Supabase Auth email confirmation...');
    const { data: authUpdateData, error: authError } = await supabase.auth.admin.updateUserById(user.id, {
      email_confirm: true,
      email_confirmed_at: new Date().toISOString() // Add this line
    });
    
    if (authError) {
      console.error('Auth update error:', authError);
      throw new Error('Failed to confirm email in authentication system');
    }
    
    console.log('Auth email confirmation updated:', authUpdateData);

    // Update custom users table
    console.log('Updating custom users table...');
    const { error: dbError } = await supabase
      .from('users')
      .update({
        email_verified: true,
        otp: null,
        otp_expiry: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);
    
    if (dbError) {
      console.error('DB update error:', dbError);
      throw new Error('Failed to update verification status');
    }

    console.log('Email verification completed successfully');
    return { message: 'Email verified successfully' };
  } catch (error) {
    console.error('Email verification error:', error);
    throw error;
  }
}

  async forgotPassword(email) {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
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

  async getUserProfile(userId) {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select(`
          *,
          user_preferences(*),
          saved_passengers(*)
        `)
        .eq('id', userId)
        .single();

      if (error) throw error;

      return this.sanitizeUser(user);
    } catch (error) {
      throw error;
    }
  }

 async updateUserProfile(userId, updateData) {
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
    
    // Handle other fields that might need mapping or direct assignment
    if (updateData.phone !== undefined) {
      dbUpdateData.phone = updateData.phone;
    }
    if (updateData.bio !== undefined) {
      dbUpdateData.bio = updateData.bio;
    }
    if (updateData.address !== undefined) {
      dbUpdateData.address = updateData.address;
    }
    if (updateData.dateofbirth !== undefined) {
      dbUpdateData.dateofbirth = updateData.dateofbirth;
    }
    if (updateData.profile_image !== undefined) {
      dbUpdateData.profile_image = updateData.profile_image;
    }
    
    // Add timestamp
    dbUpdateData.updated_at = new Date().toISOString();
    
    console.log('Updating user profile with data:', dbUpdateData);
    
    const { data: user, error } = await supabase
      .from('users')
      .update(dbUpdateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Database update error:', error);
      throw error;
    }

    console.log('Profile updated successfully:', user);

    // Update auth metadata if needed
    if (updateData.firstName || updateData.lastName || updateData.phone) {
      try {
        await supabase.auth.admin.updateUserById(userId, {
          user_metadata: {
            first_name: updateData.firstName || user.first_name,
            last_name: updateData.lastName || user.last_name,
            phone: updateData.phone || user.phone
          }
        });
        console.log('Auth metadata updated successfully');
      } catch (authError) {
        console.warn('Auth metadata update failed:', authError);
        // Don't throw here as the main profile update succeeded
      }
    }

    return this.sanitizeUser(user);
  } catch (error) {
    console.error('Profile update error:', error);
    throw error;
  }
}

  async deleteUser(userId) {
    try {
      await supabase
        .from('users')
        .update({
          status: 'deleted',
          email: `deleted_${Date.now()}@deleted.com`,
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      return { message: 'Account deleted successfully' };
    } catch (error) {
      throw error;
    }
  }

  async updateUserOTP(userId, otp) {
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    
    await supabase
      .from('users')
      .update({
        otp,
        otp_expiry: otpExpiry,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
  }

  sanitizeUser(user) {
    const { password, otp, otp_expiry, ...sanitizedUser } = user;
    return sanitizedUser;
  }

  async syncUserWithAuth(userId) {
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      
      if (authUser.user) {
        await supabase
          .from('users')
          .update({
            email_verified: authUser.user.email_confirmed_at ? true : false,
            last_login: authUser.user.last_sign_in_at,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);
      }
    } catch (error) {
      console.error('Sync error:', error);
    }
  }

  // Test database connection 
  async testConnection() {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('count(*)')
        .limit(1);
      
      if (error) {
        console.error('Database connection test failed:', error);
        return false;
      }
      
      console.log('Database connection test successful');
      return true;
    } catch (error) {
      console.error('Database connection test error:', error);
      return false;
    }
  }
}

module.exports = UserService;