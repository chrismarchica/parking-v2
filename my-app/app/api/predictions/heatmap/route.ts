import { NextRequest, NextResponse } from 'next/server';
import { getHeatmapData } from '@/lib/xgboost-api';

/**
 * GET /api/predictions/heatmap
 * 
 * Get heatmap data from the XGBoost API.
 * 
 * Query Parameters:
 * - start_date: YYYY-MM-DD (optional)
 * - end_date: YYYY-MM-DD (optional)
 * - violation_code: filter by code (optional)
 * - limit: max results (default 1000)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;
    const violationCode = searchParams.get('violation_code') || undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const result = await getHeatmapData({
      startDate,
      endDate,
      violationCode,
      limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Heatmap error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch heatmap data' },
      { status: 500 }
    );
  }
}

