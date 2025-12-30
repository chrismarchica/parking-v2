import { NextRequest, NextResponse } from 'next/server';
import { getPrediction, type PredictRequest } from '@/lib/xgboost-api';

/**
 * POST /api/predictions/predict
 * 
 * Get a parking ticket violation prediction for a location and time.
 * 
 * Body:
 * {
 *   "latitude": 40.7580,
 *   "longitude": -73.9855,
 *   "datetime": "2024-01-15T14:30:00",  // optional
 *   "precinct": "19",                    // optional
 *   "county": "NY"                       // optional
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as PredictRequest;

    // Validate required fields
    if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
      return NextResponse.json(
        { error: 'latitude and longitude are required and must be numbers' },
        { status: 400 }
      );
    }

    // Validate coordinate ranges (NYC area)
    if (body.latitude < 40.4 || body.latitude > 41.0) {
      return NextResponse.json(
        { error: 'latitude must be within NYC range (40.4 - 41.0)' },
        { status: 400 }
      );
    }
    if (body.longitude < -74.3 || body.longitude > -73.7) {
      return NextResponse.json(
        { error: 'longitude must be within NYC range (-74.3 to -73.7)' },
        { status: 400 }
      );
    }

    const result = await getPrediction(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Prediction error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Prediction failed' },
      { status: 500 }
    );
  }
}

