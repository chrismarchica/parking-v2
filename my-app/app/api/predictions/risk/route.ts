import { NextRequest, NextResponse } from 'next/server';

const XGBOOST_API_URL = process.env.XGBOOST_API_URL || 'http://localhost:5000';

/**
 * POST /api/predictions/risk
 *
 * Proxies to the ML service's /risk endpoint, which returns a 0-100 parking-ticket
 * risk score for a location + time, plus the risk across all 24 hours of that day.
 *
 * Body: { latitude: number, longitude: number, datetime?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
      return NextResponse.json(
        { error: 'latitude and longitude are required numbers' },
        { status: 400 }
      );
    }

    const res = await fetch(`${XGBOOST_API_URL}/risk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('Risk error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Risk request failed' },
      { status: 500 }
    );
  }
}
