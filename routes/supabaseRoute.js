// Add this to your routes for testing
app.get('/api/test/supabase', async (req, res) => {
  try {
    // Test basic connection
    const { data, error } = await supabase
      .from('users')
      .select('count(*)')
      .limit(1);
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        error: error.message,
        details: 'Failed to connect to users table'
      });
    }
    
    // Test auth admin functions
    const { data: authTest, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) {
      return res.status(500).json({ 
        success: false, 
        error: authError.message,
        details: 'Failed to connect to Supabase Auth (check SERVICE_ROLE_KEY)'
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Supabase connection successful',
      usersTableAccessible: true,
      authAdminAccessible: true,
      existingUsers: authTest.users.length
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Unexpected error testing Supabase connection'
    });
  }
});