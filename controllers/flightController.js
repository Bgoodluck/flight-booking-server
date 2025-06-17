const Joi = require('joi');
const { createClient } = require('@supabase/supabase-js');
const FlightSearchService = require('../services/flightSearchService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Updated validation schema to match frontend payload
const searchSchema = Joi.object({
  origin: Joi.string().required(),
  destination: Joi.string().required(),
  departureDate: Joi.date().iso().required(),
  returnDate: Joi.date().iso().allow(null).optional(),
  passengers: Joi.number().integer().min(1).max(9).required(),
  cabinClass: Joi.string().valid('economy', 'premium-economy', 'business', 'first').required(),
  tripType: Joi.string().valid('one-way', 'round-trip', 'multi-city').required(),
  directFlightsOnly: Joi.boolean().default(false),
  flexibleDates: Joi.boolean().default(false)
});

// Search for flights
const searchFlights = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = searchSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details.map(d => d.message),
        received: req.body
      });
    }

    const searchParams = value;
    const userId = req.auth?.userId || null;

    // Transform frontend format to backend format
    const transformedParams = {
      tripType: searchParams.tripType === 'round-trip' ? 'roundtrip' : 
                searchParams.tripType === 'one-way' ? 'oneway' : 'multicity',
      from: searchParams.origin,
      to: searchParams.destination,
      departureDate: searchParams.departureDate,
      returnDate: searchParams.returnDate,
      passengers: {
        adults: searchParams.passengers,
        children: 0,
        infants: 0
      },
      class: searchParams.cabinClass.replace('-', '_'), // premium-economy -> premium_economy
      directFlights: searchParams.directFlightsOnly,
      flexibleDates: searchParams.flexibleDates
    };

    // Log search request
    if (userId) {
      try {
        await supabase.from('search_history').insert({
          user_id: userId,
          search_params: transformedParams,
          created_at: new Date().toISOString()
        });
      } catch (logError) {
        console.warn('Failed to log search history:', logError);
        // Don't fail the search if logging fails
      }
    }

    // Search flights using external API (Amadeus/Mock)
    const flightResults = await FlightSearchService.searchFlights(transformedParams);

    // Store search results temporarily for booking reference
    const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      await supabase.from('flight_search_cache').insert({
        search_id: searchId,
        search_params: transformedParams,
        results: flightResults,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes
      });
    } catch (cacheError) {
      console.warn('Failed to cache search results:', cacheError);
      // Don't fail the search if caching fails
    }

    res.json({
      searchId,
      flights: flightResults, // Changed from 'results' to 'flights' to match frontend expectation
      totalResults: flightResults.length,
      searchParams: transformedParams
    });

  } catch (error) {
    console.error('Flight search error:', error);
    res.status(500).json({
      error: 'Flight Search Error',
      message: 'Unable to search flights at this time',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get flight details
const getFlightDetails = async (req, res) => {
  try {
    const { flightId } = req.params;
    
    if (!flightId) {
      return res.status(400).json({
        error: 'Missing Flight ID',
        message: 'Flight ID is required'
      });
    }
    
    // Get flight details from cache or external API
    const flightDetails = await FlightSearchService.getFlightDetails(flightId);
    
    if (!flightDetails) {
      return res.status(404).json({
        error: 'Flight Not Found',
        message: 'The requested flight could not be found'
      });
    }

    res.json(flightDetails);

  } catch (error) {
    console.error('Flight details error:', error);
    res.status(500).json({
      error: 'Flight Details Error',
      message: 'Unable to retrieve flight details'
    });
  }
};

// Get fare rules and restrictions
const getFareRules = async (req, res) => {
  try {
    const { flightId } = req.params;
    
    const fareRules = await FlightSearchService.getFareRules(flightId);
    
    res.json(fareRules);

  } catch (error) {
    console.error('Fare rules error:', error);
    res.status(500).json({
      error: 'Fare Rules Error',
      message: 'Unable to retrieve fare rules'
    });
  }
};

// Search airports
const searchAirports = async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({
        error: 'Query Too Short',
        message: 'Search query must be at least 2 characters'
      });
    }

    // Search airports from database - using correct column names
    const { data: airports, error } = await supabase
      .from('airports')
      .select('iata_code, name, city, country, latitude, longitude')
      .or(`city.ilike.%${q}%, country.ilike.%${q}%, iata_code.ilike.%${q}%, name.ilike.%${q}%`)
      .limit(10);

    if (error) throw error;

    // Format response to match frontend expectations
    const formattedAirports = airports?.map(airport => ({
      code: airport.iata_code,
      name: airport.name,
      city: airport.city,
      country: airport.country,
      latitude: airport.latitude,
      longitude: airport.longitude
    })) || [];

    res.json({ airports: formattedAirports });

  } catch (error) {
    console.error('Airport search error:', error);
    res.status(500).json({
      error: 'Airport Search Error',
      message: 'Unable to search airports'
    });
  }
};

// Get popular destinations
const getPopularDestinations = async (req, res) => {
  try {
    const { from } = req.query;

    // Updated to match your schema - using 'rank' instead of 'popularity_score'
    let query = supabase
      .from('popular_destinations')
      .select('iata_code, city, country, rank, description, image_url')
      .order('rank', { ascending: true }) // Lower rank = more popular
      .limit(12);

    const { data: destinations, error } = await query;

    if (error) throw error;

    // Format response to match frontend expectations
    const formattedDestinations = destinations?.map(dest => ({
      code: dest.iata_code,
      city: dest.city,
      country: dest.country,
      rank: dest.rank,
      description: dest.description,
      image_url: dest.image_url
    })) || [];

    res.json({ destinations: formattedDestinations });

  } catch (error) {
    console.error('Popular destinations error:', error);
    res.status(500).json({
      error: 'Popular Destinations Error',
      message: 'Unable to retrieve popular destinations'
    });
  }
};

// Get airline information
const getAirlines = async (req, res) => {
  try {
    const { active } = req.query;

    let query = supabase
      .from('airlines')
      .select('*')
      .order('name');

    if (active === 'true') {
      query = query.eq('is_active', true);
    }

    const { data: airlines, error } = await query;

    if (error) throw error;

    res.json(airlines || []);

  } catch (error) {
    console.error('Airlines error:', error);
    res.status(500).json({
      error: 'Airlines Error',
      message: 'Unable to retrieve airlines'
    });
  }
};

// Create price alert
const createPriceAlert = async (req, res) => {
  try {
    const userId = req.auth.userId;
    const {
      from,
      to,
      departureDate,
      returnDate,
      targetPrice,
      alertType // 'below', 'decrease'
    } = req.body;

    // Validate input
    if (!from || !to || !departureDate || !targetPrice) {
      return res.status(400).json({
        error: 'Missing Required Fields',
        message: 'From, to, departure date, and target price are required'
      });
    }

    // Create price alert
    const { data: alert, error } = await supabase
      .from('price_alerts')
      .insert({
        user_id: userId,
        from_airport: from,
        to_airport: to,
        departure_date: departureDate,
        return_date: returnDate,
        target_price: targetPrice,
        alert_type: alertType || 'below',
        is_active: true,
        created_at: new Date()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Price alert created successfully',
      alert
    });

  } catch (error) {
    console.error('Price alert error:', error);
    res.status(500).json({
      error: 'Price Alert Error',
      message: 'Unable to create price alert'
    });
  }
};

// Get price calendar
const getPriceCalendar = async (req, res) => {
  try {
    const { route } = req.params;
    const { month, year } = req.query;
    
    const [from, to] = route.split('-');
    
    if (!from || !to) {
      return res.status(400).json({
        error: 'Invalid Route',
        message: 'Route must be in format FROM-TO'
      });
    }

    // Get price calendar data
    const priceCalendar = await FlightSearchService.getPriceCalendar({
      from,
      to,
      month: parseInt(month) || new Date().getMonth() + 1,
      year: parseInt(year) || new Date().getFullYear()
    });

    res.json(priceCalendar);

  } catch (error) {
    console.error('Price calendar error:', error);
    res.status(500).json({
      error: 'Price Calendar Error',
      message: 'Unable to retrieve price calendar'
    });
  }
};

const getUserPriceAlerts = async (req, res) => {
  try {
    const userId = req.auth.userId; // Fixed: changed from req.user.id to req.auth.userId

    const { data: alerts, error } = await supabase
      .from('price_alerts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(alerts || []);

  } catch (error) {
    console.error('Get price alerts error:', error);
    res.status(500).json({
      error: 'Price Alerts Error',
      message: 'Unable to retrieve price alerts'
    });
  }
};

// Update price alert
const updatePriceAlert = async (req, res) => {
  try {
    const userId = req.auth.userId; // Fixed: changed from req.user.id to req.auth.userId
    const { alertId } = req.params;
    const updates = req.body;

    // Validate that user owns this alert
    const { data: alert, error: fetchError } = await supabase
      .from('price_alerts')
      .select('*')
      .eq('id', alertId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !alert) {
      return res.status(404).json({
        error: 'Alert Not Found',
        message: 'Price alert not found or access denied'
      });
    }

    // Update the alert
    const { data: updatedAlert, error } = await supabase
      .from('price_alerts')
      .update({
        ...updates,
        updated_at: new Date()
      })
      .eq('id', alertId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Price alert updated successfully',
      alert: updatedAlert
    });

  } catch (error) {
    console.error('Update price alert error:', error);
    res.status(500).json({
      error: 'Update Error',
      message: 'Unable to update price alert'
    });
  }
};

// Delete price alert
const deletePriceAlert = async (req, res) => {
  try {
    const userId = req.auth.userId; // Fixed: changed from req.user.id to req.auth.userId
    const { alertId } = req.params;

    const { error } = await supabase
      .from('price_alerts')
      .delete()
      .eq('id', alertId)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({
      message: 'Price alert deleted successfully'
    });

  } catch (error) {
    console.error('Delete price alert error:', error);
    res.status(500).json({
      error: 'Delete Error',
      message: 'Unable to delete price alert'
    });
  }
};

// Get user's search history
const getSearchHistory = async (req, res) => {
  try {
    const userId = req.auth.userId; // Fixed: changed from req.user.id to req.auth.userId
    const { limit = 20, offset = 0 } = req.query;

    const { data: history, error } = await supabase
      .from('search_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json(history || []);

  } catch (error) {
    console.error('Search history error:', error);
    res.status(500).json({
      error: 'Search History Error',
      message: 'Unable to retrieve search history'
    });
  }
};

// Delete search history item
const deleteSearchHistory = async (req, res) => {
  try {
    const userId = req.auth.userId; // Fixed: changed from req.user.id to req.auth.userId
    const { searchId } = req.params;

    const { error } = await supabase
      .from('search_history')
      .delete()
      .eq('id', searchId)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({
      message: 'Search history item deleted successfully'
    });

  } catch (error) {
    console.error('Delete search history error:', error);
    res.status(500).json({
      error: 'Delete Error',
      message: 'Unable to delete search history item'
    });
  }
};

// Add flight to favorites
const addToFavorites = async (req, res) => {
  try {
    const userId = req.auth.userId; // Fixed: changed from req.user.id to req.auth.userId
    const { flightId, flightData, searchParams } = req.body;

    if (!flightId || !flightData) {
      return res.status(400).json({
        error: 'Missing Data',
        message: 'Flight ID and flight data are required'
      });
    }

    // Check if already in favorites
    const { data: existing } = await supabase
      .from('favorite_flights')
      .select('id')
      .eq('user_id', userId)
      .eq('flight_id', flightId)
      .single();

    if (existing) {
      return res.status(409).json({
        error: 'Already Exists',
        message: 'Flight is already in favorites'
      });
    }

    // Add to favorites
    const { data: favorite, error } = await supabase
      .from('favorite_flights')
      .insert({
        user_id: userId,
        flight_id: flightId,
        flight_data: flightData,
        search_params: searchParams,
        created_at: new Date()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Flight added to favorites',
      favorite
    });

  } catch (error) {
    console.error('Add to favorites error:', error);
    res.status(500).json({
      error: 'Favorites Error',
      message: 'Unable to add flight to favorites'
    });
  }
};

// Get user's favorite flights
const getFavorites = async (req, res) => {
  try {
    const userId = req.auth.userId; // Fixed: changed from req.user.id to req.auth.userId

    const { data: favorites, error } = await supabase
      .from('favorite_flights')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(favorites || []);

  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({
      error: 'Favorites Error',
      message: 'Unable to retrieve favorite flights'
    });
  }
};

// Remove flight from favorites
const removeFromFavorites = async (req, res) => {
  try {
    const userId = req.auth.userId; // Fixed: changed from req.user.id to req.auth.userId
    const { flightId } = req.params;

    const { error } = await supabase
      .from('favorite_flights')
      .delete()
      .eq('user_id', userId)
      .eq('flight_id', flightId);

    if (error) throw error;

    res.json({
      message: 'Flight removed from favorites'
    });

  } catch (error) {
    console.error('Remove from favorites error:', error);
    res.status(500).json({
      error: 'Remove Error',
      message: 'Unable to remove flight from favorites'
    });
  }
};

module.exports = {
  searchFlights,
  getFlightDetails,
  getFareRules,
  searchAirports,
  getPopularDestinations,
  getAirlines,
  createPriceAlert,
  getPriceCalendar,
  getUserPriceAlerts,
  updatePriceAlert,
  deletePriceAlert,
  getSearchHistory,
  deleteSearchHistory,
  addToFavorites,
  getFavorites,
  removeFromFavorites
};