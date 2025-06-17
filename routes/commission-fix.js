// // Add this route to your admin routes or create a separate file
// // routes/admin.js or routes/commission-fix.js

// const express = require('express');
// const router = express.Router();
// const PartnerService = require('../services/partnerService');

// // 🔥 One-time commission fix route
// router.post('/fix-commissions/:partnerId', async (req, res) => {
//   try {
//     const { partnerId } = req.params;
    
//     // Add admin authentication check here if needed
//     // if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin only' });
    
//     console.log(`Starting commission fix for partner: ${partnerId}`);
    
//     const partnerService = new PartnerService();
//     const result = await partnerService.fixExistingCommissions('b2dd26ce-5ab6-4e28-9033-7098d66b6412', partnerId);
    
//     res.json({
//       success: true,
//       message: 'Commission recalculation completed',
//       data: result
//     });
    
//   } catch (error) {
//     console.error('Commission fix error:', error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// module.exports = router;

// // In your main app.js, add:
// // app.use('/admin', require('./routes/admin')); // or whatever you name the file


const express = require('express');
const router = express.Router();
const PartnerService = require('../services/partnerService');

// Commission fix route - CORRECTED
router.post('/fix-commissions/:partnerId', async (req, res) => {
  try {
    const { partnerId } = req.params;
    
    if (!partnerId || partnerId === ':partnerId') {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid partner ID is required' 
      });
    }
    
    console.log(`Starting commission fix for partner: ${partnerId}`);
    
    const partnerService = new PartnerService();
    const result = await partnerService.fixExistingCommissions(partnerId);
    
    res.json({
      success: true,
      message: 'Commission recalculation completed',
      data: result
    });
    
  } catch (error) {
    console.error('Commission fix error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all partners (for admin to see partner IDs)
router.get('/partners', async (req, res) => {
  try {
    const { data: partners, error } = await supabase
      .from('partners')
      .select('id, business_name, email, first_name, last_name, total_earnings, available_balance')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      partners: partners
    });
    
  } catch (error) {
    console.error('Get partners error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;