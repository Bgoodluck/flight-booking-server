// middleware/auth.js - Enhanced Authentication Middleware with Dual Support
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('🔐 Auth Middleware - Headers:', req.headers['authorization'] ? 'Present' : 'Missing');
  console.log('🔐 Auth Middleware - Token extracted:', token ? 'Yes' : 'No');

  if (!token) {
    console.log('❌ Auth Middleware - No token provided');
    return res.status(401).json({
      error: 'Access Denied',
      message: 'Access token required'
    });
  }

  try {
    let user = null;
    let authMethod = null;

    // Try to verify as custom JWT first
    if (process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('✅ Auth Middleware - Custom JWT decoded:', { 
          userId: decoded.userId || decoded.id,
          role: decoded.role,
          email: decoded.email 
        });

        const userIdFromToken = decoded.userId || decoded.id;

        if (userIdFromToken) {
          // Check if this is an admin token
          if (decoded.role === 'admin' && userIdFromToken.startsWith('admin-')) {
            // This is an admin token - create admin user object
            user = {
              id: userIdFromToken,
              email: decoded.email,
              role: 'admin',
              first_name: 'Admin',
              last_name: 'User',
              status: 'active'
            };
            authMethod = 'admin_jwt';
            console.log('✅ Auth Middleware - Admin user authenticated:', { 
              id: user.id, 
              email: user.email,
              role: user.role 
            });
          } else {
            // Regular user - check database
            const { data: customUser, error } = await supabase
              .from('users')
              .select('*')
              .eq('id', userIdFromToken)
              .single();

            if (!error && customUser) {
              user = customUser;
              authMethod = 'custom_jwt';
              console.log('✅ Auth Middleware - User found via custom JWT:', { 
                id: user.id, 
                email: user.email 
              });
            } else {
              console.log('❌ Auth Middleware - Custom user not found in database:', error);
            }
          }
        }
      } catch (jwtError) {
        console.log('❌ Auth Middleware - Custom JWT verification failed:', jwtError.message);
      }
    }

    // If custom JWT failed, try Supabase token (only for non-admin users)
    if (!user) {
      try {
        const { data: { user: supabaseUser }, error: supabaseError } = await supabase.auth.getUser(token);

        if (!supabaseError && supabaseUser) {
          console.log('✅ Auth Middleware - Supabase user found:', { 
            id: supabaseUser.id, 
            email: supabaseUser.email 
          });

          const { data: customUser, error: customError } = await supabase
            .from('users')
            .select('*')
            .eq('id', supabaseUser.id)
            .single();

          if (!customError && customUser) {
            user = customUser;
            authMethod = 'supabase_token';
            console.log('✅ Auth Middleware - User authenticated via Supabase token');
          } else {
            console.log('❌ Auth Middleware - Custom user not found for Supabase user:', customError);
          }
        } else {
          console.log('❌ Auth Middleware - Supabase token verification failed:', supabaseError);
        }
      } catch (supabaseError) {
        console.error('❌ Auth Middleware - Supabase token error:', supabaseError);
      }
    }

    if (!user) {
      console.log('❌ Auth Middleware - No user found with either method');
      return res.status(403).json({
        error: 'Invalid Token',
        message: 'Token is invalid or user not found'
      });
    }

    // Set req.user with the full user object
    req.user = user;
    req.auth = {
      userId: user.id,
      method: authMethod
    };

    console.log('✅ Auth Middleware - Authentication successful:', { 
      userId: user.id, 
      method: authMethod,
      role: user.role 
    });
    
    next();
  } catch (error) {
    console.error('❌ Auth Middleware - Token verification error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({
        error: 'Invalid Token',
        message: 'Token signature is invalid. Please log in again.'
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token Expired',
        message: 'Your session has expired, please log in again'
      });
    } else {
      return res.status(403).json({
        error: 'Authentication Failed',
        message: 'Token verification failed'
      });
    }
  }
};


// Optional auth middleware
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    req.auth = null;
    return next();
  }

  try {
    let user = null;
    let authMethod = null;

    // Try custom JWT first
    if (process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userIdFromToken = decoded.userId || decoded.id;
        
        if (userIdFromToken) {
          const { data: customUser, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userIdFromToken)
            .single();

          if (!error && customUser) {
            user = customUser;
            authMethod = 'custom_jwt';
          }
        }
      } catch (jwtError) {
        // Continue to try Supabase token
      }
    }

    // Try Supabase token if custom JWT failed
    if (!user) {
      try {
        const { data: { user: supabaseUser }, error: supabaseError } = await supabase.auth.getUser(token);
        
        if (!supabaseError && supabaseUser) {
          const { data: customUser, error: customError } = await supabase
            .from('users')
            .select('*')
            .eq('id', supabaseUser.id)
            .single();

          if (!customError && customUser) {
            user = customUser;
            authMethod = 'supabase_token';
          }
        }
      } catch (supabaseError) {
        // Ignore error for optional auth
      }
    }

    if (user) {
      req.user = user;
      req.auth = { 
        userId: user.id, 
        method: authMethod 
      };
    } else {
      req.user = null;
      req.auth = null;
    }
  } catch (error) {
    console.error('Optional auth error:', error);
    req.user = null;
    req.auth = null;
  }

  next();
};

// Enhanced partner token authentication with dual support
const authenticatePartnerToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Access Denied',
      message: 'Access token required' 
    });
  }

  try {
    let partner = null;
    let authMethod = null;

    // Try custom JWT first
    if (process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const partnerIdFromToken = decoded.userId || decoded.id;
        
        if (partnerIdFromToken) {
          const { data: partnerData, error } = await supabase
            .from('partners')
            .select('*')
            .eq('id', partnerIdFromToken)
            .single();

          if (!error && partnerData) {
            partner = partnerData;
            authMethod = 'custom_jwt';
          }
        }
      } catch (jwtError) {
        // Try Supabase token
      }
    }

    // Try Supabase token if custom JWT failed
    if (!partner) {
      try {
        const { data: { user: supabaseUser }, error: supabaseError } = await supabase.auth.getUser(token);
        
        if (!supabaseError && supabaseUser) {
          const { data: partnerData, error: partnerError } = await supabase
            .from('partners')
            .select('*')
            .eq('id', supabaseUser.id)
            .single();

          if (!partnerError && partnerData) {
            partner = partnerData;
            authMethod = 'supabase_token';
          }
        }
      } catch (supabaseError) {
        console.error('Supabase partner token verification failed:', supabaseError);
      }
    }

    if (!partner) {
      return res.status(403).json({ 
        error: 'Invalid Token',
        message: 'Token is invalid or partner not found' 
      });
    }

    req.user = partner; // This will be the partner, not a user
    req.auth = { 
      userId: partner.id, 
      method: authMethod 
    };
    next();
  } catch (error) {
    console.error('Partner token verification error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ 
        error: 'Invalid Token',
        message: 'Token signature is invalid. Please log in again.' 
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token Expired',
        message: 'Your session has expired, please log in again' 
      });
    } else {
      return res.status(403).json({ 
        error: 'Authentication Failed',
        message: 'Token verification failed' 
      });
    }
  }
};

// New: Middleware specifically for Supabase tokens only (for when you need Supabase-specific features)
const authenticateSupabaseToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Access Denied',
      message: 'Supabase access token required' 
    });
  }

  try {
    const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
    
    if (error || !supabaseUser) {
      return res.status(403).json({ 
        error: 'Invalid Token',
        message: 'Invalid Supabase token' 
      });
    }

    // Get custom user data
    const { data: customUser, error: customError } = await supabase
      .from('users')
      .select('*')
      .eq('id', supabaseUser.id)
      .single();

    if (customError || !customUser) {
      return res.status(403).json({ 
        error: 'User Not Found',
        message: 'User profile not found' 
      });
    }

    req.user = customUser;
    req.auth = { 
      userId: customUser.id, 
      method: 'supabase_token',
      supabaseUser 
    };
    next();
  } catch (error) {
    console.error('Supabase token verification error:', error);
    return res.status(403).json({ 
      error: 'Authentication Failed',
      message: 'Token verification failed' 
    });
  }
};

// New: Middleware to refresh Supabase session
const refreshSupabaseSession = async (req, res, next) => {
  const refreshToken = req.body.refresh_token || req.headers['x-refresh-token'];
  
  if (!refreshToken) {
    return res.status(400).json({
      error: 'Refresh Token Required',
      message: 'Refresh token is required'
    });
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error) {
      return res.status(401).json({
        error: 'Invalid Refresh Token',
        message: error.message
      });
    }

    // Get custom user data
    const { data: customUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    req.session = data.session;
    req.user = customUser;
    next();
  } catch (error) {
    console.error('Session refresh error:', error);
    return res.status(500).json({
      error: 'Session Refresh Failed',
      message: 'Could not refresh session'
    });
  }
};

// Role-based authorization middleware (unchanged - maintains compatibility)
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication Required',
        message: 'Please log in to access this resource' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient Permissions',
        message: 'You do not have permission to access this resource' 
      });
    }

    next();
  };
};

// Enhanced validation error handler (unchanged - maintains compatibility)
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
    return res.status(400).json({ 
      error: 'Validation Error',
      message: 'Please check your input data',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

// All existing validation middleware (unchanged - maintains compatibility)
const validateUserRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail({ gmail_remove_dots: false })
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  // Handle both camelCase and snake_case for first name
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('first_name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('last_name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Please provide a valid date of birth'),
  // Custom validation to ensure at least one name format is provided
  body().custom((value, { req }) => {
    const hasFirstName = req.body.firstName || req.body.first_name;
    const hasLastName = req.body.lastName || req.body.last_name;
    
    if (!hasFirstName) {
      throw new Error('First name is required');
    }
    if (!hasLastName) {
      throw new Error('Last name is required');
    }
    return true;
  }),
  handleValidationErrors
];

// Enhanced partner registration validation (unchanged - maintains compatibility)
const validatePartnerRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail({ gmail_remove_dots: false })
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  // Handle both camelCase and snake_case for names
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('first_name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('last_name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  // Business information - handle multiple field naming conventions
  body(['companyName', 'businessName', 'company_name', 'business_name'])
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Company/Business name must be between 2 and 100 characters'),
  body(['contactPerson', 'contact_person'])
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Contact person name must be between 2 and 100 characters'),
  body('businessType')
    .optional()
    .isIn(['travel_agency', 'airline', 'hotel', 'tour_operator', 'other'])
    .withMessage('Please select a valid business type'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body(['businessRegistration', 'business_registration'])
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Business registration number is required'),
  body(['businessAddress', 'business_address'])
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Business address must not exceed 200 characters'),
  // Custom validation for partner-specific requirements
  body().custom((value, { req }) => {
    const hasFirstName = req.body.firstName || req.body.first_name;
    const hasLastName = req.body.lastName || req.body.last_name;
    
    if (!hasFirstName) {
      throw new Error('First name is required');
    }
    if (!hasLastName) {
      throw new Error('Last name is required');
    }

    // Ensure business name is provided in at least one format
    const hasBusinessName = req.body.companyName || req.body.businessName || 
                           req.body.company_name || req.body.business_name;
    if (!hasBusinessName) {
      throw new Error('Company/Business name is required');
    }
    
    return true;
  }),
  handleValidationErrors
];

// Login validation (unchanged - maintains compatibility)
const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail({ gmail_remove_dots: false })
    .withMessage('Please provide a valid email address'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

// All existing rate limiting functionality (unchanged - maintains compatibility)
const createRateLimiter = (windowMs, max, message, skipPaths = []) => {
  const defaultSkipPaths = ['/health', '/api/health', '/api/status'];
  const allSkipPaths = [...defaultSkipPaths, ...skipPaths];
  
  return rateLimit({
    windowMs,
    max,
    message: { 
      error: 'Rate Limit Exceeded',
      message 
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      return allSkipPaths.includes(req.path);
    },
    handler: (req, res) => {
      console.log(`Rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
      res.status(429).json({
        error: 'Rate Limit Exceeded',
        message,
        retryAfter: Math.round(windowMs / 1000)
      });
    }
  });
};

// Different rate limiters for different use cases (unchanged - maintains compatibility)
const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 attempts
  'Too many authentication attempts from this IP, please try again later'
);

const apiLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests
  'Too many requests from this IP, please try again later'
);

const searchLimiter = createRateLimiter(
  1 * 60 * 1000, // 1 minute
  10, // 10 searches
  'Too many search requests, please wait before searching again'
);

const strictLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  20, // 20 requests
  'Rate limit exceeded for this endpoint'
);

const uploadLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  50, // 50 uploads
  'Too many upload attempts, please try again later'
);

// Convenience middleware combinations (unchanged - maintains compatibility)
const requireAdmin = [
  authenticateToken,
  authorizeRoles('admin', 'super_admin')
];

const requirePartner = [
  authenticateToken,
  authorizeRoles('partner', 'admin', 'super_admin')
];

const requireUser = [
  authenticateToken,
  authorizeRoles('user', 'partner', 'admin', 'super_admin')
];

// Utility functions (unchanged - maintains compatibility)
const hasPermission = (user, permission) => {
  if (!user || !user.permissions) return false;
  return user.permissions.includes(permission) || user.role === 'super_admin';
};

// Permission-based middleware (unchanged - maintains compatibility)
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication Required',
        message: 'Please log in to access this resource' 
      });
    }

    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ 
        error: 'Insufficient Permissions',
        message: `You need '${permission}' permission to access this resource` 
      });
    }

    next();
  };
};

module.exports = {
  // Enhanced core authentication (now with dual support)
  authenticateToken,
  authenticatePartnerToken,
  optionalAuth,
  
  // New Supabase-specific authentication
  authenticateSupabaseToken,
  refreshSupabaseSession,
  
  // Aliases for backward compatibility
  requireAuth: authenticateToken,
  
  // Authorization (unchanged)
  authorizeRoles,
  requirePermission,
  hasPermission,
  
  // Validation (unchanged)
  validateUserRegistration,
  validatePartnerRegistration,
  validateLogin,
  handleValidationErrors,
  
  // Rate limiting (unchanged)
  authLimiter,
  apiLimiter,
  searchLimiter,
  strictLimiter,
  uploadLimiter,
  createRateLimiter,
  
  // Convenience combinations (unchanged)
  requireAdmin,
  requirePartner,
  requireUser,
  
  // Supabase client (unchanged)
  supabase
};