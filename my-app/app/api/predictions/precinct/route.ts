import { NextRequest, NextResponse } from 'next/server';
import { predictPrecinct } from '@/lib/predictions/precinct';

/**
 * GET /api/predictions/precinct
 * 
 * Returns precinct-level predictions for expected ticket counts.
 * 
 * Query Parameters:
 * - at: ISO datetime for the prediction target (default: now)
 * - trainDays: Number of days to look back for training data (default: 60, range: 14-365)
 * - limit: Maximum number of precincts to return (default: 20)
 * 
 * Response:
 * {
 *   "as_of": "ISO datetime",
 *   "window_minutes": 60,
 *   "bucket": { "dow": 0, "hour": 13 },
 *   "train_days": 60,
 *   "rows_used": 12345,
 *   "predictions": [
 *     { "precinct": "14", "expected_tickets": 12.4, "score": 0.91 }
 *   ]
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse query parameters
    const atParam = searchParams.get('at');
    const trainDaysParam = searchParams.get('trainDays');
    const limitParam = searchParams.get('limit');

    // Validate and parse 'at' parameter
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

    // Validate and parse 'trainDays' parameter
    let trainDays: number | undefined;
    if (trainDaysParam) {
      const parsed = parseInt(trainDaysParam, 10);
      if (isNaN(parsed)) {
        return NextResponse.json(
          { error: 'Invalid "trainDays" parameter. Expected integer.' },
          { status: 400 }
        );
      }
      trainDays = parsed;
    }

    // Validate and parse 'limit' parameter
    let limit: number | undefined;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed)) {
        return NextResponse.json(
          { error: 'Invalid "limit" parameter. Expected integer.' },
          { status: 400 }
        );
      }
      limit = parsed;
    }

    // Run prediction
    const result = await predictPrecinct({ at, trainDays, limit });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Prediction error:', error);
    return NextResponse.json(
      { error: 'Internal server error during prediction.' },
      { status: 500 }
    );
  }
}

