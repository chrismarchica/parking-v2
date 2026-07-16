import { NextRequest, NextResponse } from 'next/server';
import type { HeatmapPoint, HeatmapResponse } from '@/lib/xgboost-api';
import snapshot from '@/lib/heatmap-snapshot.json';

/**
 * GET /api/predictions/heatmap
 *
 * Returns geocoded parking-ticket points for heatmap visualization.
 *
 * Served from a static, pre-geocoded snapshot (lib/heatmap-snapshot.json) so the
 * site stays fully functional with no live database or ML service to keep warm.
 * The snapshot is a one-time export of geocoded NYC parking tickets (FY2024);
 * regenerate it from the source DB if the underlying data changes.
 *
 * Query Parameters:
 * - violation_code: filter by code (optional)
 * - limit: max results (default 1000)
 */
const POINTS = snapshot as HeatmapPoint[];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const violationCode = searchParams.get('violation_code') || undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 1000;

    let points = POINTS;
    if (violationCode) {
      points = points.filter((p) => p.violation_code === violationCode);
    }
    if (Number.isFinite(limit) && limit > 0) {
      points = points.slice(0, limit);
    }

    const result: HeatmapResponse = {
      points,
      count: points.length,
      filters: { violation_code: violationCode },
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Heatmap error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch heatmap data' },
      { status: 500 }
    );
  }
}
