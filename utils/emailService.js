const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  // Generate booking confirmation HTML template
  generateBookingConfirmationTemplate(booking) {
    try {
        // Validate required booking data
        if (!booking || !booking.booking_reference) {
            throw new Error('Booking reference is required for email template');
        }

        const { 
            booking_reference, 
            contact_info, 
            flight_offer, 
            total_amount, 
            passengers,
            seat_selections = [],
            baggage_selections = [],
            created_at,
            confirmed_at 
        } = booking;

        // Check if flight offer data exists and is valid
        const hasValidFlightData = flight_offer && 
                                  flight_offer.itineraries && 
                                  Array.isArray(flight_offer.itineraries) &&
                                  flight_offer.itineraries.length > 0 &&
                                  flight_offer.itineraries[0].segments &&
                                  Array.isArray(flight_offer.itineraries[0].segments) &&
                                  flight_offer.itineraries[0].segments.length > 0;

        // If no valid flight data, return fallback template
        if (!hasValidFlightData) {
            console.warn('Flight offer data is missing or invalid, using fallback template');
            return this.generateFallbackTemplate({
                bookingReference: booking_reference,
                passengerName: passengers && passengers[0] ? `${passengers[0].first_name || ''} ${passengers[0].last_name || ''}`.trim() : 'N/A',
                bookingDate: created_at ? new Date(created_at).toLocaleDateString() : 'N/A',
                confirmationDate: confirmed_at ? new Date(confirmed_at).toLocaleDateString() : new Date().toLocaleDateString(),
                totalAmount: total_amount ? total_amount.toLocaleString() : null,
                currency: '₦'
            });
        }

        // Format dates with error handling
        const formatDate = (dateString, options) => {
            try {
                return new Date(dateString).toLocaleDateString('en-US', options);
            } catch (error) {
                return dateString || 'Date not available';
            }
        };

        const bookingDate = formatDate(created_at, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const confirmationDate = formatDate(confirmed_at, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Get flight details with error handling
        const departure = flight_offer.itineraries[0].segments[0];
        const arrival = flight_offer.itineraries[0].segments[flight_offer.itineraries[0].segments.length - 1];
        
        // Check if it's a round trip
        const isRoundTrip = flight_offer.itineraries.length > 1;
        const returnFlight = isRoundTrip && flight_offer.itineraries[1] && flight_offer.itineraries[1].segments && flight_offer.itineraries[1].segments.length > 0 
            ? flight_offer.itineraries[1].segments[0] 
            : null;
        const returnArrival = isRoundTrip && flight_offer.itineraries[1] && flight_offer.itineraries[1].segments && flight_offer.itineraries[1].segments.length > 0
            ? flight_offer.itineraries[1].segments[flight_offer.itineraries[1].segments.length - 1] 
            : null;

        // Format flight times with error handling
        const formatDateTime = (dateTime) => {
            try {
                return new Date(dateTime).toLocaleString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (error) {
                return dateTime || 'Time not available';
            }
        };

        // Generate passenger list with error handling
        const passengerList = (passengers && Array.isArray(passengers)) ? passengers.map(p => 
            `<tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${p.first_name || ''} ${p.last_name || ''}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${p.passenger_type || 'Adult'}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${p.date_of_birth || 'N/A'}</td>
            </tr>`
        ).join('') : '<tr><td colspan="3" style="padding: 8px;">No passenger information available</td></tr>';

        // Generate seat selections if any
        const seatInfo = seat_selections && seat_selections.length > 0 ? 
            seat_selections.map(seat => `${seat.passenger_name || 'Passenger'}: ${seat.seat_number || 'N/A'}`).join(', ') : 
            'No seats selected';

        // Generate baggage info if any
        const baggageInfo = baggage_selections && baggage_selections.length > 0 ? 
            baggage_selections.map(bag => `${bag.passenger_name || 'Passenger'}: ${bag.weight || 'N/A'}kg`).join(', ') : 
            'Standard baggage allowance';

        // Safe property access for flight details
        const getDepartureInfo = (segment) => ({
            code: segment?.departure?.iataCode || 'N/A',
            time: segment?.departure?.at || 'N/A',
            carrierCode: segment?.carrierCode || 'N/A',
            number: segment?.number || 'N/A'
        });

        const getArrivalInfo = (segment) => ({
            code: segment?.arrival?.iataCode || 'N/A',
            time: segment?.arrival?.at || 'N/A'
        });

        const depInfo = getDepartureInfo(departure);
        const arrInfo = getArrivalInfo(arrival);
        const retDepInfo = returnFlight ? getDepartureInfo(returnFlight) : null;
        const retArrInfo = returnArrival ? getArrivalInfo(returnArrival) : null;

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Booking Confirmation - ${booking_reference || 'N/A'}</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 700px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f4f4f4;
                }
                .container {
                    background-color: white;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                    border-bottom: 2px solid #10b981;
                    padding-bottom: 20px;
                }
                .logo {
                    font-size: 28px;
                    font-weight: bold;
                    color: #10b981;
                    margin-bottom: 10px;
                }
                .confirmation-badge {
                    background-color: #10b981;
                    color: white;
                    padding: 8px 20px;
                    border-radius: 25px;
                    font-size: 14px;
                    font-weight: bold;
                    display: inline-block;
                    margin-bottom: 15px;
                }
                .booking-ref {
                    background-color: #f0fdf4;
                    border: 2px solid #10b981;
                    padding: 15px;
                    text-align: center;
                    margin: 20px 0;
                    border-radius: 8px;
                }
                .ref-number {
                    font-size: 24px;
                    font-weight: bold;
                    color: #10b981;
                    letter-spacing: 2px;
                    font-family: 'Courier New', monospace;
                }
                .section {
                    margin: 30px 0;
                    padding: 20px;
                    background-color: #f8fafc;
                    border-radius: 8px;
                    border-left: 4px solid #10b981;
                }
                .section h3 {
                    margin-top: 0;
                    color: #10b981;
                    border-bottom: 1px solid #e2e8f0;
                    padding-bottom: 10px;
                }
                .flight-details {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin: 15px 0;
                    padding: 15px;
                    background-color: white;
                    border-radius: 6px;
                    border: 1px solid #e2e8f0;
                }
                .flight-info {
                    text-align: center;
                    flex: 1;
                }
                .airport-code {
                    font-size: 20px;
                    font-weight: bold;
                    color: #1f2937;
                }
                .city-name {
                    font-size: 12px;
                    color: #6b7280;
                    margin-top: 2px;
                }
                .flight-time {
                    font-weight: bold;
                    color: #374151;
                    margin-top: 5px;
                }
                .flight-arrow {
                    margin: 0 20px;
                    color: #10b981;
                    font-size: 20px;
                }
                .passenger-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 15px;
                }
                .passenger-table th {
                    background-color: #10b981;
                    color: white;
                    padding: 12px 8px;
                    text-align: left;
                }
                .price-breakdown {
                    background-color: #f9fafb;
                    padding: 20px;
                    border-radius: 8px;
                    margin: 20px 0;
                }
                .price-row {
                    display: flex;
                    justify-content: space-between;
                    margin: 8px 0;
                    padding: 5px 0;
                }
                .total-price {
                    border-top: 2px solid #10b981;
                    padding-top: 10px;
                    margin-top: 15px;
                    font-size: 18px;
                    font-weight: bold;
                    color: #10b981;
                }
                .important-info {
                    background-color: #fef3c7;
                    border-left: 4px solid #f59e0b;
                    padding: 15px;
                    margin: 20px 0;
                    border-radius: 4px;
                }
                .footer {
                    margin-top: 40px;
                    padding-top: 20px;
                    border-top: 1px solid #eee;
                    text-align: center;
                    color: #666;
                    font-size: 14px;
                }
                .qr-placeholder {
                    width: 100px;
                    height: 100px;
                    background-color: #f3f4f6;
                    border: 2px dashed #9ca3af;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 20px auto;
                    border-radius: 8px;
                    font-size: 12px;
                    color: #6b7280;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">Elevatio</div>
                    <div class="confirmation-badge">✈️ BOOKING CONFIRMED</div>
                    <h1>Your Flight is Booked!</h1>
                    <p>Thank you for choosing Elevatio. Your booking has been confirmed.</p>
                </div>
                
                <div class="booking-ref">
                    <div style="margin-bottom: 10px; font-weight: bold; color: #10b981;">Booking Reference</div>
                    <div class="ref-number">${booking_reference || 'N/A'}</div>
                    <div style="margin-top: 8px; font-size: 14px; color: #6b7280;">Keep this reference for your records</div>
                </div>

                <div class="section">
                    <h3>✈️ Flight Details</h3>
                    
                    <!-- Outbound Flight -->
                    <div style="margin-bottom: 20px;">
                        <h4 style="color: #374151; margin-bottom: 15px;">
                            ${isRoundTrip ? 'Outbound Flight' : 'Flight'} - ${depInfo.carrierCode} ${depInfo.number}
                        </h4>
                        <div class="flight-details">
                            <div class="flight-info">
                                <div class="airport-code">${depInfo.code}</div>
                                <div class="city-name">${depInfo.time}</div>
                                <div class="flight-time">${formatDateTime(depInfo.time)}</div>
                            </div>
                            <span class="flight-arrow">✈️</span>
                            <div class="flight-info">
                                <div class="airport-code">${arrInfo.code}</div>
                                <div class="city-name">${arrInfo.time}</div>
                                <div class="flight-time">${formatDateTime(arrInfo.time)}</div>
                            </div>
                        </div>
                    </div>

                    ${isRoundTrip && retDepInfo && retArrInfo ? `
                    <!-- Return Flight -->
                    <div style="margin-bottom: 20px;">
                        <h4 style="color: #374151; margin-bottom: 15px;">
                            Return Flight - ${retDepInfo.carrierCode} ${retDepInfo.number}
                        </h4>
                        <div class="flight-details">
                            <div class="flight-info">
                                <div class="airport-code">${retDepInfo.code}</div>
                                <div class="city-name">${retDepInfo.time}</div>
                                <div class="flight-time">${formatDateTime(retDepInfo.time)}</div>
                            </div>
                            <span class="flight-arrow">✈️</span>
                            <div class="flight-info">
                                <div class="airport-code">${retArrInfo.code}</div>
                                <div class="city-name">${retArrInfo.time}</div>
                                <div class="flight-time">${formatDateTime(retArrInfo.time)}</div>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                </div>

                <div class="section">
                    <h3>👥 Passenger Information</h3>
                    <table class="passenger-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Date of Birth</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${passengerList}
                        </tbody>
                    </table>
                </div>

                <div class="section">
                    <h3>💺 Additional Services</h3>
                    <p><strong>Seat Selections:</strong> ${seatInfo}</p>
                    <p><strong>Baggage:</strong> ${baggageInfo}</p>
                </div>

                <div class="section">
                    <h3>💰 Payment Summary</h3>
                    <div class="price-breakdown">
                        <div class="price-row">
                            <span>Flight Total:</span>
                            <span>₦${(total_amount || 0).toLocaleString()}</span>
                        </div>
                        <div class="price-row total-price">
                            <span>Total Paid:</span>
                            <span>₦${(total_amount || 0).toLocaleString()}</span>
                        </div>
                    </div>
                    <p style="margin-top: 15px; color: #10b981; font-weight: bold;">✅ Payment Confirmed on ${confirmationDate}</p>
                </div>

                <div class="important-info">
                    <h4 style="margin-top: 0; color: #92400e;">⚠️ Important Information</h4>
                    <ul style="margin: 10px 0; padding-left: 20px;">
                        <li>Please arrive at the airport at least 2 hours before domestic flights and 3 hours before international flights</li>
                        <li>Ensure your travel documents (passport/ID) are valid and match the passenger names</li>
                        <li>Check-in online 24 hours before departure to save time</li>
                        <li>Keep your booking reference handy for check-in and at the airport</li>
                    </ul>
                </div>

                <div class="section">
                    <h3>📱 Mobile Boarding Pass</h3>
                    <p>Save this email or take a screenshot of your booking reference. You can use it for mobile check-in.</p>
                    <div class="qr-placeholder">
                        QR Code<br>Coming Soon
                    </div>
                </div>

                <div class="section">
                    <h3>📞 Need Help?</h3>
                    <p>If you need to make changes to your booking or have any questions:</p>
                    <ul style="margin: 10px 0; padding-left: 20px;">
                        <li><strong>Email:</strong> support@elevatio.com</li>
                        <li><strong>Phone:</strong> +234 (0) 1 234 5678</li>
                        <li><strong>WhatsApp:</strong> +234 (0) 8012 345 678</li>
                    </ul>
                    <p><strong>Booking Reference:</strong> ${booking_reference || 'N/A'}</p>
                </div>

                <div style="text-align: center; margin: 30px 0;">
                    <p style="font-size: 18px; color: #10b981; font-weight: bold;">Have a wonderful trip! ✈️</p>
                </div>

                <div class="footer">
                    <p>This is an automated confirmation email. Please do not reply to this message.</p>
                    <p>Booked on ${bookingDate} | Confirmed on ${confirmationDate}</p>
                    <p>&copy; 2025 Elevatio. All rights reserved.</p>
                    <p style="margin-top: 15px;">
                        <a href="#" style="color: #10b981; text-decoration: none;">Manage Booking</a> | 
                        <a href="#" style="color: #10b981; text-decoration: none;">Contact Support</a> | 
                        <a href="#" style="color: #10b981; text-decoration: none;">Flight Status</a>
                    </p>
                </div>
            </div>
        </body>
        </html>
        `;

    } catch (error) {
        console.error('Error generating booking confirmation template:', error);
        // Return fallback template if there's an error
        return this.generateFallbackTemplate({
            bookingReference: booking?.booking_reference || 'N/A',
            passengerName: booking?.passengers?.[0] ? `${booking.passengers[0].first_name || ''} ${booking.passengers[0].last_name || ''}`.trim() : 'N/A',
            bookingDate: booking?.created_at ? new Date(booking.created_at).toLocaleDateString() : 'N/A',
            confirmationDate: booking?.confirmed_at ? new Date(booking.confirmed_at).toLocaleDateString() : new Date().toLocaleDateString(),
            totalAmount: booking?.total_amount ? booking.total_amount.toLocaleString() : null,
            currency: '₦'
        });
    }
}

// Fallback template when there are errors or missing flight data
generateFallbackTemplate(data) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmation - ${data.bookingReference || 'N/A'}</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 700px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f4f4f4;
            }
            .container {
                background-color: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
                border-bottom: 2px solid #10b981;
                padding-bottom: 20px;
            }
            .logo {
                font-size: 28px;
                font-weight: bold;
                color: #10b981;
                margin-bottom: 10px;
            }
            .confirmation-badge {
                background-color: #10b981;
                color: white;
                padding: 8px 20px;
                border-radius: 25px;
                font-size: 14px;
                font-weight: bold;
                display: inline-block;
                margin-bottom: 15px;
            }
            .booking-ref {
                background-color: #f0fdf4;
                border: 2px solid #10b981;
                padding: 15px;
                text-align: center;
                margin: 20px 0;
                border-radius: 8px;
            }
            .ref-number {
                font-size: 24px;
                font-weight: bold;
                color: #10b981;
                letter-spacing: 2px;
                font-family: 'Courier New', monospace;
            }
            .section {
                margin: 30px 0;
                padding: 20px;
                background-color: #f8fafc;
                border-radius: 8px;
                border-left: 4px solid #10b981;
            }
            .section h3 {
                margin-top: 0;
                color: #10b981;
                border-bottom: 1px solid #e2e8f0;
                padding-bottom: 10px;
            }
            .booking-details {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                margin: 20px 0;
            }
            .detail-item {
                padding: 15px;
                background-color: white;
                border-radius: 6px;
                border: 1px solid #e2e8f0;
            }
            .detail-label {
                font-weight: bold;
                color: #6b7280;
                font-size: 14px;
                margin-bottom: 5px;
            }
            .detail-value {
                color: #1f2937;
                font-size: 16px;
            }
            .status-processing {
                background-color: #fef3c7;
                border-left: 4px solid #f59e0b;
                padding: 15px;
                margin: 20px 0;
                border-radius: 4px;
            }
            .footer {
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                text-align: center;
                color: #666;
                font-size: 14px;
            }
            @media (max-width: 600px) {
                .booking-details { grid-template-columns: 1fr; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Elevatio</div>
                <div class="confirmation-badge">✅ BOOKING CONFIRMED</div>
                <h1>Your Flight is Booked!</h1>
                <p>Thank you for choosing Elevatio. Your booking has been confirmed.</p>
            </div>
            
            <div class="booking-ref">
                <div style="margin-bottom: 10px; font-weight: bold; color: #10b981;">Booking Reference</div>
                <div class="ref-number">${data.bookingReference || 'N/A'}</div>
                <div style="margin-top: 8px; font-size: 14px; color: #6b7280;">Keep this reference for your records</div>
            </div>

            <div class="section">
                <h3>📋 Booking Summary</h3>
                <div class="booking-details">
                    <div class="detail-item">
                        <div class="detail-label">Passenger Name</div>
                        <div class="detail-value">${data.passengerName || 'N/A'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Booking Date</div>
                        <div class="detail-value">${data.bookingDate || 'N/A'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Confirmation Date</div>
                        <div class="detail-value">${data.confirmationDate || new Date().toLocaleDateString()}</div>
                    </div>
                    ${data.totalAmount ? `
                    <div class="detail-item">
                        <div class="detail-label">Total Amount</div>
                        <div class="detail-value">${data.currency || '₦'} ${data.totalAmount}</div>
                    </div>
                    ` : ''}
                </div>
            </div>

            <div class="status-processing">
                <h4 style="margin-top: 0; color: #92400e;">✈️ Flight Details Processing</h4>
                <p><strong>Your booking is confirmed and payment has been processed successfully!</strong></p>
                <p>Flight details are currently being finalized and will be available shortly. You will receive:</p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>Complete flight itinerary with times and gate information</li>
                    <li>Mobile boarding passes (available 24 hours before departure)</li>
                    <li>Check-in reminders and flight status updates</li>
                </ul>
                <p>Please check your booking dashboard or contact our support team for the latest updates.</p>
            </div>

            <div class="section">
                <h3>📞 Need Help?</h3>
                <p>If you need to make changes to your booking or have any questions:</p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li><strong>Email:</strong> support@elevatio.com</li>
                    <li><strong>Phone:</strong> +234 (0) 1 234 5678</li>
                    <li><strong>WhatsApp:</strong> +234 (0) 8012 345 678</li>
                </ul>
                <p><strong>Booking Reference:</strong> ${data.bookingReference || 'N/A'}</p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
                <p style="font-size: 18px; color: #10b981; font-weight: bold;">We're preparing your journey! ✈️</p>
            </div>

            <div class="footer">
                <p>This is an automated confirmation email. Please do not reply to this message.</p>
                <p>Booked on ${data.bookingDate || 'N/A'} | Confirmed on ${data.confirmationDate || new Date().toLocaleDateString()}</p>
                <p>&copy; 2025 Elevatio. All rights reserved.</p>
                <p style="margin-top: 15px;">
                    <a href="#" style="color: #10b981; text-decoration: none;">Manage Booking</a> | 
                    <a href="#" style="color: #10b981; text-decoration: none;">Contact Support</a> | 
                    <a href="#" style="color: #10b981; text-decoration: none;">Flight Status</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    `;
}
  // Generate email verification HTML template
  generateEmailVerificationTemplate(data) {
    const { firstName, otp } = data;
    
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email - Elevatio</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f4f4f4;
            }
            .container {
                background-color: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            .logo {
                font-size: 24px;
                font-weight: bold;
                color: #2563eb;
                margin-bottom: 10px;
            }
            .otp-code {
                background-color: #f8f9fa;
                border: 2px dashed #2563eb;
                padding: 20px;
                text-align: center;
                margin: 20px 0;
                border-radius: 8px;
            }
            .otp-number {
                font-size: 32px;
                font-weight: bold;
                color: #2563eb;
                letter-spacing: 5px;
                font-family: 'Courier New', monospace;
            }
            .footer {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                text-align: center;
                color: #666;
                font-size: 14px;
            }
            .warning {
                background-color: #fff3cd;
                border-left: 4px solid #ffc107;
                padding: 15px;
                margin: 20px 0;
                border-radius: 4px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Elevatio</div>
                <h1>Verify Your Email Address</h1>
            </div>
            
            <p>Hello ${firstName},</p>
            
            <p>Thank you for signing up with Elevatio! To complete your registration and secure your account, please verify your email address using the code below:</p>
            
            <div class="otp-code">
                <div style="margin-bottom: 10px; font-weight: bold; color: #2563eb;">Your Verification Code</div>
                <div class="otp-number">${otp}</div>
            </div>
            
            <p>Enter this code on the verification page to activate your account. This code is valid for <strong>10 minutes</strong>.</p>
            
            <div class="warning">
                <strong>Security Note:</strong> If you didn't create an account with Elevatio, please ignore this email. Do not share this code with anyone.
            </div>
            
            <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
            
            <p>Welcome aboard!<br>
            The Elevatio Team</p>
            
            <div class="footer">
                <p>This is an automated email. Please do not reply to this message.</p>
                <p>&copy; 2025 Elevatio. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  // Generate PARTNER email verification HTML template
  generatePartnerEmailVerificationTemplate(data) {
    const { firstName, otp, businessName } = data;
    
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Partner Account - Elevatio</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f4f4f4;
            }
            .container {
                background-color: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            .logo {
                font-size: 24px;
                font-weight: bold;
                color: #10b981;
                margin-bottom: 10px;
            }
            .partner-badge {
                background-color: #10b981;
                color: white;
                padding: 5px 15px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: bold;
                display: inline-block;
                margin-bottom: 20px;
            }
            .otp-code {
                background-color: #f0fdf4;
                border: 2px dashed #10b981;
                padding: 20px;
                text-align: center;
                margin: 20px 0;
                border-radius: 8px;
            }
            .otp-number {
                font-size: 32px;
                font-weight: bold;
                color: #10b981;
                letter-spacing: 5px;
                font-family: 'Courier New', monospace;
            }
            .footer {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                text-align: center;
                color: #666;
                font-size: 14px;
            }
            .warning {
                background-color: #fff3cd;
                border-left: 4px solid #ffc107;
                padding: 15px;
                margin: 20px 0;
                border-radius: 4px;
            }
            .business-info {
                background-color: #f8fafc;
                padding: 15px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #10b981;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Elevatio</div>
                <div class="partner-badge">PARTNER ACCOUNT</div>
                <h1>Verify Your Partner Account</h1>
            </div>
            
            <p>Hello ${firstName},</p>
            
            <p>Thank you for joining Elevatio as a partner! We're excited to have <strong>${businessName}</strong> as part of our network.</p>
            
            <div class="business-info">
                <strong>Business:</strong> ${businessName}<br>
                <strong>Contact:</strong> ${firstName}
            </div>
            
            <p>To complete your partner registration and activate your account, please verify your email address using the code below:</p>
            
            <div class="otp-code">
                <div style="margin-bottom: 10px; font-weight: bold; color: #10b981;">Your Partner Verification Code</div>
                <div class="otp-number">${otp}</div>
            </div>
            
            <p>Enter this code on the verification page to activate your partner account. This code is valid for <strong>10 minutes</strong>.</p>
            
            <p>Once verified, your account will be reviewed by our team for approval. You'll receive another email once your partner account is approved and ready to start earning commissions.</p>
            
            <div class="warning">
                <strong>Security Note:</strong> If you didn't apply for a partner account with Elevatio, please ignore this email. Do not share this code with anyone.
            </div>
            
            <p>If you have any questions about the partner program or need assistance, please don't hesitate to contact our partner support team.</p>
            
            <p>Welcome to the Elevatio Partner Network!<br>
            The Elevatio Partner Team</p>
            
            <div class="footer">
                <p>This is an automated email. Please do not reply to this message.</p>
                <p>&copy; 2025 Elevatio. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  // Generate partner registration notification template (for admin)
  generatePartnerRegistrationTemplate(data) {
    const { businessName, contactPerson, email } = data;
    
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Partner Registration - Elevatio</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f4f4f4;
            }
            .container {
                background-color: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            .logo {
                font-size: 24px;
                font-weight: bold;
                color: #f59e0b;
                margin-bottom: 10px;
            }
            .alert-badge {
                background-color: #f59e0b;
                color: white;
                padding: 5px 15px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: bold;
                display: inline-block;
                margin-bottom: 20px;
            }
            .partner-details {
                background-color: #f8fafc;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #f59e0b;
            }
            .footer {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                text-align: center;
                color: #666;
                font-size: 14px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Elevatio</div>
                <div class="alert-badge">ADMIN NOTIFICATION</div>
                <h1>New Partner Registration</h1>
            </div>
            
            <p>A new partner has registered and is awaiting approval:</p>
            
            <div class="partner-details">
                <h3>Partner Information:</h3>
                <p><strong>Business Name:</strong> ${businessName}</p>
                <p><strong>Contact Person:</strong> ${contactPerson}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Status:</strong> Pending Approval</p>
            </div>
            
            <p>Please review this partner application in the admin dashboard and take appropriate action.</p>
            
            <p>Best regards,<br>
            Elevatio System</p>
            
            <div class="footer">
                <p>This is an automated notification. Please do not reply to this message.</p>
                <p>&copy; 2025 Elevatio. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  // Generate password reset HTML template
  generatePasswordResetTemplate(data) {
    const { firstName, otp } = data;
    
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password - Elevatio</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f4f4f4;
            }
            .container {
                background-color: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            .logo {
                font-size: 24px;
                font-weight: bold;
                color: #dc3545;
                margin-bottom: 10px;
            }
            .otp-code {
                background-color: #f8f9fa;
                border: 2px dashed #dc3545;
                padding: 20px;
                text-align: center;
                margin: 20px 0;
                border-radius: 8px;
            }
            .otp-number {
                font-size: 32px;
                font-weight: bold;
                color: #dc3545;
                letter-spacing: 5px;
                font-family: 'Courier New', monospace;
            }
            .footer {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                text-align: center;
                color: #666;
                font-size: 14px;
            }
            .warning {
                background-color: #f8d7da;
                border-left: 4px solid #dc3545;
                padding: 15px;
                margin: 20px 0;
                border-radius: 4px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Elevatio</div>
                <h1>Reset Your Password</h1>
            </div>
            
            <p>Hello ${firstName},</p>
            
            <p>We received a request to reset your password for your Elevatio account. Use the code below to reset your password:</p>
            
            <div class="otp-code">
                <div style="margin-bottom: 10px; font-weight: bold; color: #dc3545;">Password Reset Code</div>
                <div class="otp-number">${otp}</div>
            </div>
            
            <p>Enter this code on the password reset page to create a new password. This code is valid for <strong>10 minutes</strong>.</p>
            
            <div class="warning">
                <strong>Security Alert:</strong> If you didn't request a password reset, please ignore this email and consider changing your password immediately. Do not share this code with anyone.
            </div>
            
            <p>If you continue to have issues accessing your account, please contact our support team.</p>
            
            <p>Best regards,<br>
            The Elevatio Team</p>
            
            <div class="footer">
                <p>This is an automated email. Please do not reply to this message.</p>
                <p>&copy; 2025 Elevatio. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  // Generate partner approval HTML template
  generatePartnerApprovalTemplate(data) {
    const { firstName, businessName, email, approvalDate } = data;
    
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Partner Account Approved - Elevatio</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f4f4f4;
            }
            .container {
                background-color: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
                border-bottom: 2px solid #10b981;
                padding-bottom: 20px;
            }
            .logo {
                font-size: 28px;
                font-weight: bold;
                color: #10b981;
                margin-bottom: 10px;
            }
            .approval-badge {
                background-color: #10b981;
                color: white;
                padding: 8px 20px;
                border-radius: 25px;
                font-size: 14px;
                font-weight: bold;
                display: inline-block;
                margin-bottom: 15px;
            }
            .celebration {
                font-size: 48px;
                margin: 20px 0;
            }
            .business-info {
                background-color: #f0fdf4;
                border: 2px solid #10b981;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
                text-align: center;
            }
            .business-name {
                font-size: 24px;
                font-weight: bold;
                color: #10b981;
                margin-bottom: 10px;
            }
            .section {
                margin: 30px 0;
                padding: 20px;
                background-color: #f8fafc;
                border-radius: 8px;
                border-left: 4px solid #10b981;
            }
            .section h3 {
                margin-top: 0;
                color: #10b981;
                border-bottom: 1px solid #e2e8f0;
                padding-bottom: 10px;
            }
            .benefits-list {
                list-style: none;
                padding: 0;
            }
            .benefits-list li {
                padding: 8px 0;
                border-bottom: 1px solid #e2e8f0;
                position: relative;
                padding-left: 25px;
            }
            .benefits-list li:before {
                content: "✅";
                position: absolute;
                left: 0;
            }
            .cta-section {
                background-color: #10b981;
                color: white;
                padding: 25px;
                border-radius: 8px;
                text-align: center;
                margin: 30px 0;
            }
            .cta-button {
                display: inline-block;
                background-color: white;
                color: #10b981;
                padding: 12px 30px;
                text-decoration: none;
                border-radius: 6px;
                font-weight: bold;
                margin-top: 15px;
            }
            .next-steps {
                background-color: #fef3c7;
                border-left: 4px solid #f59e0b;
                padding: 20px;
                margin: 20px 0;
                border-radius: 4px;
            }
            .footer {
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #eee;
                text-align: center;
                color: #666;
                font-size: 14px;
            }
            .contact-info {
                background-color: #f1f5f9;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Elevatio</div>
                <div class="approval-badge">🎉 PARTNER APPROVED</div>
                <div class="celebration">🚀✈️🎊</div>
                <h1>Congratulations! Your Partner Account is Approved</h1>
            </div>
            
            <p>Dear ${firstName},</p>
            
            <p>We're thrilled to inform you that your partner application has been <strong>approved</strong>! Welcome to the Elevatio Partner Network.</p>
            
            <div class="business-info">
                <div class="business-name">${businessName}</div>
                <div style="color: #6b7280;">is now an official Elevatio Partner</div>
                <div style="margin-top: 15px; font-size: 14px; color: #374151;">
                    <strong>Partner Email:</strong> ${email}<br>
                    <strong>Approved On:</strong> ${approvalDate || new Date().toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                    })}
                </div>
            </div>

            <div class="section">
                <h3>🌟 Partner Benefits</h3>
                <p>As an approved partner, you now have access to:</p>
                <ul class="benefits-list">
                    <li>Competitive commission rates on every booking</li>
                    <li>Real-time booking and commission tracking</li>
                    <li>Marketing materials and promotional tools</li>
                    <li>Dedicated partner support team</li>
                    <li>Monthly performance reports and analytics</li>
                    <li>Early access to new features and services</li>
                    <li>Partner training and certification programs</li>
                </ul>
            </div>

            <div class="cta-section">
                <h3 style="margin-top: 0;">Ready to Start Earning?</h3>
                <p>Log in to your partner dashboard to get your unique referral codes and start earning commissions today!</p>
                <a href="#" class="cta-button">Access Partner Dashboard</a>
            </div>

            <div class="next-steps">
                <h4 style="margin-top: 0; color: #92400e;">📋 Next Steps</h4>
                <ol style="margin: 10px 0; padding-left: 20px;">
                    <li><strong>Log in to your dashboard</strong> using your registered email and password</li>
                    <li><strong>Complete your partner profile</strong> with business details and banking information</li>
                    <li><strong>Get your referral codes</strong> and marketing materials</li>
                    <li><strong>Start promoting</strong> Elevatio services to your customers</li>
                    <li><strong>Track your earnings</strong> in real-time through the dashboard</li>
                </ol>
            </div>

            <div class="section">
                <h3>💰 Commission Structure</h3>
                <p>Here's how you'll earn with every successful booking:</p>
                <ul style="margin: 15px 0; padding-left: 20px;">
                    <li><strong>Domestic Flights:</strong> 2.5% commission</li>
                    <li><strong>International Flights:</strong> 3.5% commission</li>
                    <li><strong>Hotel Bookings:</strong> 4% commission</li>
                    <li><strong>Package Deals:</strong> 5% commission</li>
                </ul>
                <p><em>Commissions are calculated on the net booking value and paid monthly.</em></p>
            </div>

            <div class="contact-info">
                <h4 style="margin-top: 0; color: #10b981;">🤝 Partner Support</h4>
                <p>Our dedicated partner support team is here to help you succeed:</p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li><strong>Partner Support Email:</strong> partners@elevatio.com</li>
                    <li><strong>Partner Hotline:</strong> +234 (0) 1 234 5679</li>
                    <li><strong>WhatsApp Support:</strong> +234 (0) 8012 345 679</li>
                    <li><strong>Business Hours:</strong> Monday - Friday, 8:00 AM - 6:00 PM WAT</li>
                </ul>
            </div>

            <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f0fdf4; border-radius: 8px;">
                <p style="font-size: 18px; color: #10b981; font-weight: bold; margin: 0;">
                    Welcome to the Elevatio family! 🎉
                </p>
                <p style="margin: 10px 0; color: #374151;">
                    We're excited to partner with ${businessName} and help you grow your business.
                </p>
            </div>

            <div class="footer">
                <p>This is an automated notification. Please do not reply to this message.</p>
                <p>For partner support, use the contact information provided above.</p>
                <p>&copy; 2025 Elevatio. All rights reserved.</p>
                <p style="margin-top: 15px;">
                    <a href="#" style="color: #10b981; text-decoration: none;">Partner Dashboard</a> | 
                    <a href="#" style="color: #10b981; text-decoration: none;">Partner Resources</a> | 
                    <a href="#" style="color: #10b981; text-decoration: none;">Contact Support</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

// Generate payout notification HTML template
generatePayoutNotificationTemplate(data) {
  const { partner_name, business_name, amount, payout_id, requested_at } = data;
  
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payout Request Received - Elevatio</title>
      <style>
          body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f4f4f4;
          }
          .container {
              background-color: white;
              padding: 30px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .header {
              text-align: center;
              margin-bottom: 30px;
              border-bottom: 2px solid #10b981;
              padding-bottom: 20px;
          }
          .logo {
              font-size: 28px;
              font-weight: bold;
              color: #10b981;
              margin-bottom: 10px;
          }
          .status-badge {
              background-color: #10b981;
              color: white;
              padding: 8px 20px;
              border-radius: 25px;
              font-size: 14px;
              font-weight: bold;
              display: inline-block;
              margin-bottom: 15px;
          }
          .payout-details {
              background-color: #f0fdf4;
              border: 2px solid #10b981;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
              text-align: center;
          }
          .payout-amount {
              font-size: 32px;
              font-weight: bold;
              color: #10b981;
              margin: 15px 0;
          }
          .payout-id {
              font-family: 'Courier New', monospace;
              background-color: #f8fafc;
              padding: 8px 12px;
              border-radius: 4px;
              font-size: 14px;
              color: #374151;
              display: inline-block;
              margin-top: 10px;
          }
          .section {
              margin: 30px 0;
              padding: 20px;
              background-color: #f8fafc;
              border-radius: 8px;
              border-left: 4px solid #10b981;
          }
          .section h3 {
              margin-top: 0;
              color: #10b981;
              border-bottom: 1px solid #e2e8f0;
              padding-bottom: 10px;
          }
          .timeline-item {
              display: flex;
              align-items: center;
              margin: 15px 0;
              padding: 10px 0;
              border-bottom: 1px solid #e2e8f0;
          }
          .timeline-icon {
              background-color: #10b981;
              color: white;
              width: 30px;
              height: 30px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              margin-right: 15px;
              font-size: 14px;
          }
          .timeline-content {
              flex: 1;
          }
          .timeline-title {
              font-weight: bold;
              color: #374151;
              margin-bottom: 2px;
          }
          .timeline-desc {
              color: #6b7280;
              font-size: 14px;
          }
          .info-box {
              background-color: #dbeafe;
              border-left: 4px solid #3b82f6;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
          }
          .warning-box {
              background-color: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
          }
          .footer {
              margin-top: 40px;
              padding-top: 20px;
              border-top: 1px solid #eee;
              text-align: center;
              color: #666;
              font-size: 14px;
          }
          .contact-info {
              background-color: #f1f5f9;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
          }
      </style>
  </head>
  <body>
      <div class="container">
          <div class="header">
              <div class="logo">Elevatio</div>
              <div class="status-badge">💰 PAYOUT REQUEST</div>
              <h1>Your Payout Request Has Been Received</h1>
          </div>
          
          <p>Dear ${partner_name},</p>
          
          <p>We have successfully received your payout request for <strong>${business_name}</strong>. Your request is now being processed by our finance team.</p>
          
          <div class="payout-details">
              <div style="margin-bottom: 10px; font-weight: bold; color: #10b981;">Payout Amount</div>
              <div class="payout-amount">₦${parseFloat(amount).toLocaleString()}</div>
              <div style="margin-top: 15px; color: #6b7280;">
                  <strong>Business:</strong> ${business_name}<br>
                  <strong>Requested On:</strong> ${requested_at}
              </div>
              <div class="payout-id">
                  Request ID: ${payout_id}
              </div>
          </div>

          <div class="section">
              <h3>📋 Processing Timeline</h3>
              <div class="timeline-item">
                  <div class="timeline-icon">✅</div>
                  <div class="timeline-content">
                      <div class="timeline-title">Request Submitted</div>
                      <div class="timeline-desc">Your payout request has been received and logged</div>
                  </div>
              </div>
              <div class="timeline-item">
                  <div class="timeline-icon">🔍</div>
                  <div class="timeline-content">
                      <div class="timeline-title">Under Review</div>
                      <div class="timeline-desc">Our finance team is verifying your request</div>
                  </div>
              </div>
              <div class="timeline-item">
                  <div class="timeline-icon">💳</div>
                  <div class="timeline-content">
                      <div class="timeline-title">Payment Processing</div>
                      <div class="timeline-desc">Funds will be transferred to your account</div>
                  </div>
              </div>
              <div class="timeline-item">
                  <div class="timeline-icon">✨</div>
                  <div class="timeline-content">
                      <div class="timeline-title">Completed</div>
                      <div class="timeline-desc">You'll receive a confirmation email</div>
                  </div>
              </div>
          </div>

          <div class="info-box">
              <h4 style="margin-top: 0; color: #1e40af;">ℹ️ Processing Information</h4>
              <ul style="margin: 10px 0; padding-left: 20px;">
                  <li><strong>Processing Time:</strong> 3-5 business days</li>
                  <li><strong>Payment Method:</strong> Bank transfer to your registered account</li>
                  <li><strong>Notification:</strong> You'll receive an email once payment is completed</li>
                  <li><strong>Reference:</strong> Keep your request ID for any inquiries</li>
              </ul>
          </div>

          <div class="warning-box">
              <h4 style="margin-top: 0; color: #92400e;">⚠️ Important Notes</h4>
              <ul style="margin: 10px 0; padding-left: 20px;">
                  <li>Ensure your bank account details are up to date in your profile</li>
                  <li>Payments are processed during business hours (Monday-Friday)</li>
                  <li>Contact support immediately if you notice any discrepancies</li>
                  <li>Keep this email for your records</li>
              </ul>
          </div>

          <div class="section">
              <h3>📊 Account Summary</h3>
              <p>This payout request includes commissions from your recent successful bookings. You can view detailed commission reports in your partner dashboard.</p>
              <p style="margin-top: 15px;">
                  <strong>Request ID:</strong> ${payout_id}<br>
                  <strong>Amount:</strong> ₦${parseFloat(amount).toLocaleString()}<br>
                  <strong>Status:</strong> Processing<br>
                  <strong>Expected Completion:</strong> 3-5 business days
              </p>
          </div>

          <div class="contact-info">
              <h4 style="margin-top: 0; color: #10b981;">💬 Need Help?</h4>
              <p>If you have any questions about your payout request:</p>
              <ul style="margin: 10px 0; padding-left: 20px;">
                  <li><strong>Partner Support:</strong> partners@elevatio.com</li>
                  <li><strong>Finance Team:</strong> finance@elevatio.com</li>
                  <li><strong>Phone:</strong> +234 (0) 1 234 5679</li>
                  <li><strong>WhatsApp:</strong> +234 (0) 8012 345 679</li>
              </ul>
              <p><strong>When contacting support, please include your Request ID: <span style="font-family: monospace; background-color: #f3f4f6; padding: 2px 6px; border-radius: 3px;">${payout_id}</span></strong></p>
          </div>

          <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f0fdf4; border-radius: 8px;">
              <p style="font-size: 18px; color: #10b981; font-weight: bold; margin: 0;">
                  Thank you for being a valued partner! 💚
              </p>
              <p style="margin: 10px 0; color: #374151;">
                  Your success is our success. Keep up the great work!
              </p>
          </div>

          <div class="footer">
              <p>This is an automated notification. Please do not reply to this message.</p>
              <p>For support, use the contact information provided above.</p>
              <p>&copy; 2025 Elevatio. All rights reserved.</p>
              <p style="margin-top: 15px;">
                  <a href="#" style="color: #10b981; text-decoration: none;">Partner Dashboard</a> | 
                  <a href="#" style="color: #10b981; text-decoration: none;">View Commissions</a> | 
                  <a href="#" style="color: #10b981; text-decoration: none;">Contact Support</a>
              </p>
          </div>
      </div>
  </body>
  </html>
  `;
}

  async sendEmail({ to, subject, template, data }) {
  try {
    let html;
    
    // Generate HTML based on template type
    switch (template) {
      case 'email-verification':
        html = this.generateEmailVerificationTemplate(data);
        break;
      case 'booking-confirmation':
        html = this.generateBookingConfirmationTemplate(data);
        break;
      case 'partner-email-verification':
        html = this.generatePartnerEmailVerificationTemplate(data);
        break;
      case 'partner-registration':
        html = this.generatePartnerRegistrationTemplate(data);
        break;
      case 'partner-approval':
        html = this.generatePartnerApprovalTemplate(data);
        break;
      case 'password-reset':
        html = this.generatePasswordResetTemplate(data);
        break;
      case 'payout-notification':
        html = this.generatePayoutNotificationTemplate(data);
        break;
      default:
        // Option 1: Use fallback template for unknown templates
        if (data && typeof data === 'object') {
          console.warn(`Unknown email template: ${template}, using fallback template`);
          html = this.generateFallbackTemplate(data);
        } else {
          // Still throw error if no valid data is provided
          throw new Error(`Unknown email template: ${template}`);
        }
        break;
    }
    
    // Send email
    const info = await this.transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to,
      subject,
      html
    });

    console.log('Email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
}
}

const emailService = new EmailService();

module.exports = {
  sendEmail: emailService.sendEmail.bind(emailService)
};