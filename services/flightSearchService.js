const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class FlightSearchService {
  constructor() {
    this.amadeusBaseUrl = 'https://test.api.amadeus.com';
    this.tokenCache = null;
    this.tokenExpiry = null;
  }

  async getAmadeusToken() {
    try {
      // Check if we have a valid cached token
      if (this.tokenCache && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.tokenCache;
      }

      // Create form data for the token request
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', process.env.AMADEUS_API_KEY);
      params.append('client_secret', process.env.AMADEUS_API_SECRET);

      const response = await axios.post(`${this.amadeusBaseUrl}/v1/security/oauth2/token`, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      this.tokenCache = response.data.access_token;
      // Set expiry to 90% of actual expiry to ensure we refresh before it expires
      this.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 900));
      
      console.log('Amadeus token obtained successfully');
      return this.tokenCache;
    } catch (error) {
      console.error('Amadeus token error:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Amadeus API');
    }
  }

  buildAmadeusSearchParams(searchParams) {
    const params = {};

    // Extract airport codes from the format "City (CODE)"
    const extractAirportCode = (location) => {
      if (!location) return '';
      const match = location.match(/\(([A-Z]{3})\)/);
      return match ? match[1] : location.toUpperCase();
    };

    // Handle both frontend parameter names (origin/destination) and backend names (from/to)
    const fromLocation = searchParams.from || searchParams.origin;
    const toLocation = searchParams.to || searchParams.destination;
    
    params.originLocationCode = extractAirportCode(fromLocation);
    params.destinationLocationCode = extractAirportCode(toLocation);
    
    // Handle both departureDate and departDate
    const departureDate = searchParams.departureDate || searchParams.departDate;
    if (departureDate) {
      const depDate = new Date(departureDate);
      if (!isNaN(depDate.getTime())) {
        params.departureDate = depDate.toISOString().split('T')[0];
      }
    }

    // Handle return date
    const returnDate = searchParams.returnDate || searchParams.returnDate;
    if (returnDate && searchParams.tripType === 'round-trip') {
      const retDate = new Date(returnDate);
      if (!isNaN(retDate.getTime())) {
        params.returnDate = retDate.toISOString().split('T')[0];
      }
    }

    // Passenger counts - handle both object and number formats
    let passengers = searchParams.passengers;
    if (typeof passengers === 'object') {
      params.adults = passengers.adults || 1;
      if (passengers.children > 0) params.children = passengers.children;
      if (passengers.infants > 0) params.infants = passengers.infants;
    } else if (typeof passengers === 'number') {
      params.adults = passengers;
    } else {
      params.adults = 1;
    }

    // Travel class mapping - handle both class and cabinClass
    const travelClass = searchParams.class || searchParams.cabinClass;
    const classMapping = {
      'economy': 'ECONOMY',
      'premium-economy': 'PREMIUM_ECONOMY',
      'premium_economy': 'PREMIUM_ECONOMY',
      'business': 'BUSINESS',
      'first': 'FIRST'
    };
    params.travelClass = classMapping[travelClass] || 'ECONOMY';

    // Direct flights option
    params.nonStop = searchParams.directFlights || searchParams.directFlightsOnly || false;
    params.max = 50; // Limit results

    console.log('Built Amadeus search params:', params);
    return params;
  }

  transformAmadeusResponse(amadeusData, searchParams) {
    if (!amadeusData || !amadeusData.data) {
      return [];
    }

    return amadeusData.data.map((offer, index) => {
      const itinerary = offer.itineraries[0];
      const segment = itinerary.segments[0];
      const lastSegment = itinerary.segments[itinerary.segments.length - 1];
      
      // Calculate total duration
      const totalDuration = this.parseDuration(itinerary.duration);
      
      return {
        id: offer.id || `flight_${index}`,
        airline: segment.carrierCode,
        flightNumber: `${segment.carrierCode}${segment.number}`,
        departure: {
          time: this.formatTime(segment.departure.at),
          airport: segment.departure.iataCode,
          terminal: segment.departure.terminal || ''
        },
        arrival: {
          time: this.formatTime(lastSegment.arrival.at),
          airport: lastSegment.arrival.iataCode,
          terminal: lastSegment.arrival.terminal || ''
        },
        duration: totalDuration,
        stops: itinerary.segments.length - 1,
        price: parseFloat(offer.price.total),
        currency: offer.price.currency,
        cabinClass: offer.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin || 'ECONOMY',
        baggage: {
          cabin: '1 carry-on bag',
          checked: offer.travelerPricings[0]?.fareDetailsBySegment[0]?.includedCheckedBags?.quantity || 0
        },
        amenities: this.getAmenities(offer),
        bookingClass: offer.travelerPricings[0]?.fareDetailsBySegment[0]?.class || 'Y',
        segments: itinerary.segments.map(seg => ({
          departure: {
            airport: seg.departure.iataCode,
            time: this.formatTime(seg.departure.at),
            terminal: seg.departure.terminal
          },
          arrival: {
            airport: seg.arrival.iataCode,
            time: this.formatTime(seg.arrival.at),
            terminal: seg.arrival.terminal
          },
          airline: seg.carrierCode,
          flightNumber: `${seg.carrierCode}${seg.number}`,
          aircraft: seg.aircraft?.code || 'Unknown',
          duration: this.parseDuration(seg.duration)
        }))
      };
    });
  }

  parseDuration(isoDuration) {
    if (!isoDuration) return '0h 0m';
    
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return '0h 0m';
    
    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    
    return `${hours}h ${minutes}m`;
  }

  formatTime(isoString) {
    if (!isoString) return '00:00';
    
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '00:00';
      
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (error) {
      return '00:00';
    }
  }

  getAmenities(offer) {
    const amenities = [];
    
    // Check for included services
    if (offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.includedCheckedBags?.quantity > 0) {
      amenities.push('Checked baggage included');
    }
    
    // Add standard amenities based on cabin class
    const cabin = offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin;
    switch (cabin) {
      case 'BUSINESS':
        amenities.push('Priority boarding', 'Lounge access', 'Premium meals');
        break;
      case 'FIRST':
        amenities.push('Priority boarding', 'Lounge access', 'Premium meals', 'Flat bed');
        break;
      case 'PREMIUM_ECONOMY':
        amenities.push('Extra legroom', 'Priority boarding');
        break;
      default:
        amenities.push('In-flight entertainment');
    }
    
    return amenities;
  }

  getMockFlightData(searchParams) {
    // Your existing mock data generation code...
    try {
      const now = new Date();
      const departureDate = searchParams.departureDate || searchParams.departDate ? 
        new Date(searchParams.departureDate || searchParams.departDate) : 
        new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
      const returnDate = searchParams.returnDate ? 
        new Date(searchParams.returnDate) : 
        new Date(departureDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Validate dates
      if (isNaN(departureDate.getTime()) || isNaN(returnDate.getTime())) {
        throw new Error('Invalid date provided');
      }

      const airlines = [
        { code: 'DL', name: 'Delta Airlines' },
        { code: 'AA', name: 'American Airlines' },
        { code: 'UA', name: 'United Airlines' },
        { code: 'BA', name: 'British Airways' },
        { code: 'LH', name: 'Lufthansa' },
        { code: 'EK', name: 'Emirates' },
        { code: 'QR', name: 'Qatar Airways' },
        { code: 'AF', name: 'Air France' }
      ];

      const extractAirportCode = (location) => {
        if (!location) return 'NYC';
        const match = location.match(/\(([A-Z]{3})\)/);
        return match ? match[1] : location.substring(0, 3).toUpperCase();
      };

      const fromLocation = searchParams.from || searchParams.origin;
      const toLocation = searchParams.to || searchParams.destination;
      
      const fromCode = extractAirportCode(fromLocation);
      const toCode = extractAirportCode(toLocation);

      const mockFlights = [];

      // Generate multiple flight options
      for (let i = 0; i < 8; i++) {
        const airline = airlines[i % airlines.length];
        const basePrice = 200 + (i * 50) + Math.floor(Math.random() * 200);
        const departureHour = 6 + (i * 2);
        const flightDuration = 180 + Math.floor(Math.random() * 300); // 3-8 hours in minutes
        
        const departureTime = new Date(departureDate);
        departureTime.setHours(departureHour, Math.floor(Math.random() * 60));
        
        const arrivalTime = new Date(departureTime.getTime() + (flightDuration * 60 * 1000));
        
        const stops = i % 3 === 0 ? 0 : (i % 4 === 0 ? 2 : 1);
        
        const flight = {
          id: `mock_flight_${i + 1}`,
          airline: airline.code,
          airlineName: airline.name,
          flightNumber: `${airline.code}${100 + i}`,
          departure: {
            time: departureTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            airport: fromCode,
            terminal: String.fromCharCode(65 + (i % 4)) // A, B, C, D
          },
          arrival: {
            time: arrivalTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            airport: toCode,
            terminal: String.fromCharCode(65 + ((i + 1) % 4))
          },
          duration: `${Math.floor(flightDuration / 60)}h ${flightDuration % 60}m`,
          stops: stops,
          price: basePrice,
          currency: 'USD',
          cabinClass: (searchParams.class || searchParams.cabinClass || 'economy').toUpperCase(),
          baggage: {
            cabin: '1 carry-on bag (10kg)',
            checked: stops === 0 ? '1 checked bag (23kg)' : '2 checked bags (23kg each)'
          },
          amenities: stops === 0 ? 
            ['Direct flight', 'In-flight entertainment', 'Meal service'] :
            ['In-flight entertainment', 'Meal service', 'Wi-Fi available'],
          bookingClass: 'Y',
          segments: [{
            departure: {
              airport: fromCode,
              time: departureTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
              terminal: String.fromCharCode(65 + (i % 4))
            },
            arrival: {
              airport: toCode,
              time: arrivalTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
              terminal: String.fromCharCode(65 + ((i + 1) % 4))
            },
            airline: airline.code,
            flightNumber: `${airline.code}${100 + i}`,
            aircraft: ['Boeing 737', 'Airbus A320', 'Boeing 777', 'Airbus A350'][i % 4],
            duration: `${Math.floor(flightDuration / 60)}h ${flightDuration % 60}m`
          }]
        };

        mockFlights.push(flight);
      }

      // Sort by price
      return mockFlights.sort((a, b) => a.price - b.price);

    } catch (error) {
      console.error('Mock flight data generation error:', error);
      
      // Return minimal fallback data
      return [{
        id: 'fallback_flight_1',
        airline: 'DL',
        airlineName: 'Delta Airlines',
        flightNumber: 'DL123',
        departure: { time: '08:00', airport: 'JFK', terminal: 'A' },
        arrival: { time: '14:00', airport: 'LAX', terminal: 'B' },
        duration: '6h 0m',
        stops: 0,
        price: 350,
        currency: 'USD',
        cabinClass: 'ECONOMY',
        baggage: { cabin: '1 carry-on bag', checked: '1 checked bag' },
        amenities: ['In-flight entertainment'],
        bookingClass: 'Y',
        segments: [{
          departure: { airport: 'JFK', time: '08:00', terminal: 'A' },
          arrival: { airport: 'LAX', time: '14:00', terminal: 'B' },
          airline: 'DL',
          flightNumber: 'DL123',
          aircraft: 'Boeing 737',
          duration: '6h 0m'
        }]
      }];
    }
  }

  async searchFlights(searchParams) {
    try {
      console.log('Starting flight search with params:', searchParams);
      
      // Check if API credentials are available and not empty
      if (!process.env.AMADEUS_API_KEY || !process.env.AMADEUS_API_SECRET || 
          process.env.AMADEUS_API_KEY.trim() === '' || process.env.AMADEUS_API_SECRET.trim() === '') {
        console.log('Amadeus API credentials not available, using mock data...');
        return this.getMockFlightData(searchParams);
      }

      console.log('Attempting to get Amadeus token...');
      const token = await this.getAmadeusToken();
      
      // Build search parameters
      const amadeusParams = this.buildAmadeusSearchParams(searchParams);
      
      // Validate required parameters
      if (!amadeusParams.originLocationCode || !amadeusParams.destinationLocationCode || !amadeusParams.departureDate) {
        console.error('Missing required search parameters:', amadeusParams);
        throw new Error('Missing required search parameters');
      }

      console.log('Making Amadeus API request with params:', amadeusParams);
      
      const response = await axios.get(`${this.amadeusBaseUrl}/v2/shopping/flight-offers`, {
        params: amadeusParams,
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: 30000 // 30 second timeout
      });

      console.log('Amadeus API response received:', response.data);

      // Transform Amadeus response to our format
      const transformedResults = this.transformAmadeusResponse(response.data, searchParams);
      
      // If no results from API, return mock data
      if (!transformedResults || transformedResults.length === 0) {
        console.log('No results from Amadeus API, using mock data...');
        return this.getMockFlightData(searchParams);
      }

      console.log(`Successfully transformed ${transformedResults.length} flights from Amadeus API`);
      return transformedResults;

    } catch (error) {
      console.error('Flight search service error:', error.response?.data || error.message);
      
      // Log specific error details for debugging
      if (error.response) {
        console.error('API Error Status:', error.response.status);
        console.error('API Error Data:', error.response.data);
      }
      
      // Fallback to mock data if external API fails
      console.log('Falling back to mock data due to error...');
      return this.getMockFlightData(searchParams);
    }
  }

  async getFlightDetails(flightId) {
    try {
      // First, try to get from cache
      const { data: cachedFlight } = await supabase
        .from('flight_search_cache')
        .select('results')
        .eq('search_id', flightId.split('_')[0] + '_' + flightId.split('_')[1]) // Extract search ID pattern
        .single();

      if (cachedFlight && cachedFlight.results) {
        const flight = cachedFlight.results.find(f => f.id === flightId);
        if (flight) return flight;
      }

      // If not in cache and we have Amadeus API, try to fetch
      if (process.env.AMADEUS_API_KEY && process.env.AMADEUS_API_KEY.trim() !== '') {
        const token = await this.getAmadeusToken();
        
        const response = await axios.get(`${this.amadeusBaseUrl}/v2/shopping/flight-offers/${flightId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.data && response.data.data) {
          return this.transformAmadeusResponse({ data: [response.data.data] })[0];
        }
      }

      // Return null if not found
      return null;

    } catch (error) {
      console.error('Get flight details error:', error);
      return null;
    }
  }
}

// Export a singleton instance
const flightSearchService = new FlightSearchService();
module.exports = flightSearchService;