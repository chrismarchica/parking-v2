import { NextResponse } from 'next/server';
import { getViolationStats } from '@/lib/xgboost-api';

/**
 * GET /api/predictions/violations
 * 
 * Get violation statistics from the XGBoost API.
 */
export async function GET() {
  try {
    const result = await getViolationStats();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Violations stats error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch violation stats' },
      { status: 500 }
    );
  }
}

