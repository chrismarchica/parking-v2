import { NextResponse } from 'next/server';
import { getHotspots } from '@/lib/xgboost-api';

/**
 * GET /api/predictions/hotspots
 * 
 * Get location hotspots from the XGBoost API.
 */
export async function GET() {
  try {
    const result = await getHotspots();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Hotspots error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch hotspots' },
      { status: 500 }
    );
  }
}

