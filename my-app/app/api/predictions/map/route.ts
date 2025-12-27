import { NextRequest, NextResponse } from 'next/server';
import { predictPrecinct } from '@/lib/predictions/precinct';
import { getPrecinctLocation } from '@/lib/predictions/precinct-locations';
import { getDb } from '@/lib/db';

/**
 * GET /api/predictions/map
 * 
 * Returns time-aware precinct predictions with geographic coordinates for map visualization.
 * Uses current time by default, comparing with historical data for the same day/hour.
 * Falls back to historical data when no recent data is available.
 * 
 * Query Parameters:
 * - at: ISO datetime (default: now, or fallback to latest data)
 * - trainDays: lookback days (default: 60)
 * - limit: max precincts (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse parameters
    const atParam = searchParams.get('at');
    const trainDaysParam = searchParams.get('trainDays');
    const limitParam = searchParams.get('limit');

    let at: Date | undefined;
    if (atParam) {
      const parsed = new Date(atParam);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'Invalid "at" parameter. Expected ISO datetime.' },
          { status: 400 }
        );
      }
      at = parsed;
    }

    let trainDays: number | undefined;
    if (trainDaysParam) {
      const parsed = parseInt(trainDaysParam, 10);
      if (!isNaN(parsed)) trainDays = parsed;
    }

    let limit: number | undefined;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed)) limit = parsed;
    }

    // Get predictions for requested time
    let result = await predictPrecinct({
      at,
      trainDays,
      limit: limit ?? 50,
    });

    // If no data found and no explicit 'at' was requested, fall back to latest available data
    if (result.rows_used === 0 && !atParam) {
      const db = getDb();
      const latestRes = await db.query(
        "SELECT MAX(issue_date) as max_date FROM parking_ticket WHERE issue_date <= CURRENT_DATE"
      );
      const latestDate = latestRes.rows[0]?.max_date;
      
      if (latestDate) {
        // Use the same hour as "now" but on the latest date with data
        const now = new Date();
        const fallbackDate = new Date(latestDate);
        fallbackDate.setUTCHours(now.getUTCHours(), 0, 0, 0);
        
        result = await predictPrecinct({
          at: fallbackDate,
          trainDays: trainDays ?? 90,
          limit: limit ?? 50,
        });
      }
    }

    // Day names for display
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Format hour for display
    const formatHour = (hour: number): string => {
      if (hour === 0) return '12:00 AM';
      if (hour === 12) return '12:00 PM';
      if (hour < 12) return `${hour}:00 AM`;
      return `${hour - 12}:00 PM`;
    };

    // Classify intensity based on score
    const getIntensity = (score: number): 'low' | 'medium' | 'high' | 'very_high' => {
      if (score < 0.5) return 'low';
      if (score < 0.8) return 'medium';
      if (score < 0.95) return 'high';
      return 'very_high';
    };

    // Build GeoJSON features
    const features = result.predictions
      .map((pred) => {
        const location = getPrecinctLocation(pred.precinct);
        if (!location) return null;

        return {
          type: 'Feature' as const,
          properties: {
            precinct: pred.precinct,
            name: location.name,
            borough: location.borough,
            expected_tickets: pred.expected_tickets,
            score: pred.score,
            intensity: getIntensity(pred.score),
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [location.lon, location.lat],
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    return NextResponse.json({
      type: 'FeatureCollection',
      as_of: result.as_of,
      bucket: {
        dow: result.bucket.dow,
        hour: result.bucket.hour,
        dow_name: dayNames[result.bucket.dow],
        hour_display: formatHour(result.bucket.hour),
      },
      train_days: result.train_days,
      rows_used: result.rows_used,
      features,
    });
  } catch (error) {
    console.error('Map prediction error:', error);
    return NextResponse.json(
      { error: 'Internal server error during prediction.' },
      { status: 500 }
    );
  }
}

