const crypto = require('crypto');

const generateOTP = (length = 6) => {
  const digits = '0123456789';
  let otp = '';
  
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  
  return otp;
};

const generateSecureToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

module.exports = {
  generateOTP,
  generateSecureToken
};