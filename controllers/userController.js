const UserService = require('../services/userService');
const { createClient } = require('@supabase/supabase-js');

const userService = new UserService();

// Initialize Supabase client for logout functionality
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

class UserController {
  async register(req, res) {
    try {
      console.log('Registration request received:', {
        body: { ...req.body, password: '[HIDDEN]' }
      });
      
      // Validate required fields
      const { email, password, firstName, lastName } = req.body;
      
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ 
          error: 'Missing required fields: email, password, firstName, lastName' 
        });
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ 
          error: 'Invalid email format' 
        });
      }
      
      // Validate password length
      if (password.length < 6) {
        return res.status(400).json({ 
          error: 'Password must be at least 6 characters long' 
        });
      }
      
      console.log('Validation passed, calling userService.registerUser...');
      const result = await userService.registerUser(req.body);
      
      console.log('Registration successful:', result);
      res.status(201).json(result);
      
    } catch (error) {
      console.error('Registration controller error:', error);
      
      // Return more specific error messages
      if (error.message.includes('already exists')) {
        return res.status(409).json({ error: error.message });
      }
      
      if (error.message.includes('Auth registration failed')) {
        return res.status(400).json({ error: 'Authentication setup failed. Please try again.' });
      }
      
      if (error.message.includes('Profile creation failed')) {
        return res.status(400).json({ error: 'Profile creation failed. Please try again.' });
      }
      
      res.status(500).json({ 
        error: 'Registration failed. Please try again.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  async verifyEmail(req, res) {
  try {
    console.log('Email verification request received:', req.body);
    
    const { email, otp } = req.body;
    
    // Validate input
    if (!email || !otp) {
      console.log('Missing required fields:', { email: !!email, otp: !!otp });
      return res.status(400).json({ error: 'Email and OTP are required' });
    }
    
    // Validate OTP format (should be 6 digits)
    if (!/^\d{6}$/.test(otp)) {
      console.log('Invalid OTP format:', otp);
      return res.status(400).json({ error: 'OTP must be a 6-digit number' });
    }
    
    console.log('Calling userService.verifyEmail with:', { email, otp });
    const result = await userService.verifyEmail(email, otp);
    
    console.log('Verification successful:', result);
    res.json(result);
  } catch (error) {
    console.error('Email verification controller error:', error);
    
    // Return appropriate status codes based on error type
    if (error.message.includes('No user found') || 
        error.message.includes('Invalid OTP') ||
        error.message.includes('expired')) {
      return res.status(400).json({ error: error.message });
    }
    
    // Generic server error
    res.status(500).json({ 
      error: 'Verification failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

  // Traditional login with custom JWT + Supabase session
  async login(req, res) {
    try {
      const { email, password } = req.body;
      const result = await userService.loginUser(email, password);
      
      // Set httpOnly cookie for refresh token (optional security enhancement)
      if (result.refreshToken) {
        res.cookie('refreshToken', result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });
      }
      
      res.json(result);
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  }

  // Login using Supabase session token
  async loginWithSupabaseSession(req, res) {
    try {
      const { supabaseAccessToken } = req.body;
      
      if (!supabaseAccessToken) {
        return res.status(400).json({ error: 'Supabase access token is required' });
      }
      
      const result = await userService.loginWithSupabaseSession(supabaseAccessToken);
      res.json({ user: result });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  }

  async getProfile(req, res) {
    try {
      const profile = await userService.getUserProfile(req.user.id);
      res.json(profile);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async updateProfile(req, res) {
    try {
      const updatedProfile = await userService.updateUserProfile(req.user.id, req.body);
      res.json(updatedProfile);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async deleteAccount(req, res) {
    try {
      const result = await userService.deleteUser(req.user.id);
      
      // Clear refresh token cookie
      res.clearCookie('refreshToken');
      
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async forgotPassword(req, res) {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      
      const result = await userService.forgotPassword(email);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // For Supabase's built-in password reset
  async resetPassword(req, res) {
    try {
      const { accessToken, newPassword } = req.body;
      
      if (!accessToken || !newPassword) {
        return res.status(400).json({ 
          error: 'Access token and new password are required' 
        });
      }
      
      const result = await userService.resetPassword(accessToken, newPassword);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // Refresh token endpoint
  async refreshToken(req, res) {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token is required' });
    }

    // Use Supabase to refresh the session
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Generate new custom JWT
    const jwt = require('jsonwebtoken');
    
    // Get user from Supabase session
    const userProfile = await userService.loginWithSupabaseSession(data.session.access_token);
    
    // Create new custom JWT
    const customToken = jwt.sign(
      { 
        userId: userProfile.id, 
        role: userProfile.role,
        email: userProfile.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set new refresh token cookie
    if (data.session.refresh_token) {
      res.cookie('refreshToken', data.session.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
    }

    res.json({
      token: customToken, // Return custom JWT for frontend
      supabaseToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user: userProfile
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
}

  // Sync user data between Supabase Auth and custom table
  async syncUserData(req, res) {
    try {
      await userService.syncUserWithAuth(req.user.id);
      const updatedProfile = await userService.getUserProfile(req.user.id);
      res.json({ 
        message: 'User data synchronized successfully',
        user: updatedProfile 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }


  async validateToken(req, res) {
  try {
    // The custom JWT middleware has already validated the token
    // and populated req.user
    res.json({
      valid: true,
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      authenticated: true
    });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(401).json({ 
      valid: false, 
      error: 'Invalid token',
      authenticated: false 
    });
  }
}

  // Logout (handles both custom JWT and Supabase sessions)
  async logout(req, res) {
    try {
      // If using Supabase session, sign out
      const supabaseToken = req.headers.authorization?.replace('Bearer ', '');
      
      if (supabaseToken) {
        // Create Supabase client with the user's token
        const userSupabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_ANON_KEY,
          {
            global: {
              headers: {
                Authorization: `Bearer ${supabaseToken}`
              }
            }
          }
        );
        
        await userSupabase.auth.signOut();
      }
      
      // Clear refresh token cookie
      res.clearCookie('refreshToken');
      
      res.json({ message: 'Successfully logged out' });
    } catch (error) {
      // Even if logout fails, clear the cookie
      res.clearCookie('refreshToken');
      res.json({ message: 'Logged out (with errors)', error: error.message });
    }
  }

  // Health check endpoint to verify user session
  // async verifySession(req, res) {
  //   try {
  //     // The authenticateToken middleware already verified the token
  //     // and populated req.user, so we just need to return the user data
      
  //     if (!req.user) {
  //       return res.status(401).json({
  //         valid: false,
  //         error: 'Session invalid',
  //         message: 'User session not found'
  //       });
  //     }

  //     // Optionally fetch fresh user data from database using service role client
  //     const serviceRoleSupabase = createClient(
  //       process.env.SUPABASE_URL,
  //       process.env.SUPABASE_SERVICE_ROLE_KEY
  //     );

  //     const { data: freshUser, error } = await serviceRoleSupabase
  //       .from('users')
  //       .select('*')
  //       .eq('id', req.user.id)
  //       .single();

  //     if (error) {
  //       console.error('Error fetching fresh user data:', error);
  //       // Return cached user data if DB fetch fails
  //       return res.json({
  //         valid: true,
  //         user: userService.sanitizeUser(req.user), // Use userService method
  //         method: req.auth?.method || 'unknown'
  //       });
  //     }

  //     res.json({
  //       valid: true,
  //       user: userService.sanitizeUser(freshUser), // Use userService method
  //       method: req.auth?.method || 'unknown'
  //     });
  //   } catch (error) {
  //     console.error('Session verification error:', error);
  //     res.status(500).json({
  //       valid: false,
  //       error: 'Internal Server Error',
  //       message: 'Session verification failed'
  //     });
  //   }
  // }

  async verifySession(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({
        valid: false,
        error: 'Session invalid'
      });
    }

    // Don't fetch fresh data on every verification - it's expensive
    // Only return token validation result
    res.json({
      valid: true,
      user: userService.sanitizeUser(req.user),
      method: req.auth?.method || 'jwt'
    });
  } catch (error) {
    console.error('Session verification error:', error);
    res.status(401).json({
      valid: false,
      error: 'Session verification failed'
    });
  }
}


sanitizeUser(user) {
  if (!user) return null;
  const { password, otp, otp_expiry, ...sanitizedUser } = user;
  return sanitizedUser;
}

  async testConnection(req, res) {
    try {
      const isConnected = await userService.testConnection();
      res.json({ connected: isConnected });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = UserController;