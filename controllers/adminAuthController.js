const jwt = require('jsonwebtoken');

class AdminAuthController {
  async login(req, res) {
    try {
      const { email, password } = req.body;

      console.log('🔐 Admin login attempt:', { email, timestamp: new Date().toISOString() });

      // Validate input
      if (!email || !password) {
        console.error('❌ Missing email or password');
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Email and password are required'
        });
      }

      // Check if credentials match environment variables
      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPassword = process.env.ADMIN_PASS;

      if (!adminEmail || !adminPassword) {
        console.error('❌ Admin credentials not configured in environment');
        return res.status(500).json({
          error: 'Server Configuration Error',
          message: 'Admin credentials not configured'
        });
      }

      // Validate credentials
      if (email !== adminEmail || password !== adminPassword) {
        console.error('❌ Invalid admin credentials:', { 
          providedEmail: email, 
          expectedEmail: adminEmail 
        });
        return res.status(401).json({
          error: 'Invalid Credentials',
          message: 'Invalid email or password'
        });
      }

      // Check JWT secret
      if (!process.env.JWT_SECRET) {
        console.error('❌ JWT_SECRET not configured');
        return res.status(500).json({
          error: 'Server Configuration Error',
          message: 'JWT configuration missing'
        });
      }

      // Create admin user object
      const adminUser = {
        id: 'admin-' + Date.now(),
        email: adminEmail,
        role: 'admin',
        first_name: 'Admin',
        last_name: 'User',
        status: 'active',
        created_at: new Date().toISOString()
      };

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: adminUser.id,
          id: adminUser.id,
          email: adminUser.email,
          role: adminUser.role
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      console.log('✅ Admin login successful:', { 
        email: adminUser.email, 
        role: adminUser.role,
        tokenGenerated: true
      });

      return res.status(200).json({
        success: true,
        message: 'Admin login successful',
        token,
        user: {
          id: adminUser.id,
          email: adminUser.email,
          role: adminUser.role,
          first_name: adminUser.first_name,
          last_name: adminUser.last_name
        }
      });

    } catch (error) {
      console.error('❌ Admin login error:', error);
      return res.status(500).json({
        error: 'Login Failed',
        message: 'An error occurred during login',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  async validate(req, res) {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({
          error: 'Unauthorized',
          message: 'Admin access required'
        });
      }

      return res.status(200).json({
        valid: true,
        user: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          first_name: req.user.first_name,
          last_name: req.user.last_name
        }
      });
    } catch (error) {
      console.error('❌ Admin token validation error:', error);
      return res.status(500).json({
        error: 'Validation Failed',
        message: 'Token validation failed'
      });
    }
  }

  async logout(req, res) {
    try {
      console.log('✅ Admin logout:', { 
        userId: req.user?.id, 
        email: req.user?.email,
        timestamp: new Date().toISOString()
      });
      
      return res.status(200).json({
        success: true,
        message: 'Admin logout successful'
      });
    } catch (error) {
      console.error('❌ Admin logout error:', error);
      return res.status(500).json({
        error: 'Logout Failed',
        message: 'An error occurred during logout'
      });
    }
  }
}

module.exports = AdminAuthController;