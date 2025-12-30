import { NextResponse } from 'next/server';
import { getTemporalDistribution } from '@/lib/xgboost-api';

/**
 * GET /api/predictions/temporal
 * 
 * Get temporal distribution of tickets from the XGBoost API.
 */
export async function GET() {
  try {
    const result = await getTemporalDistribution();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Temporal distribution error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch temporal distribution' },
      { status: 500 }
    );
  }
}

