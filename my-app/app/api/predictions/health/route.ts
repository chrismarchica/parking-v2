import { NextResponse } from 'next/server';
import { checkHealth } from '@/lib/xgboost-api';

/**
 * GET /api/predictions/health
 * 
 * Check XGBoost API health status.
 */
export async function GET() {
  try {
    const result = await checkHealth();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      { 
        status: 'unhealthy', 
        model_loaded: false,
        error: error instanceof Error ? error.message : 'Health check failed' 
      },
      { status: 503 }
    );
  }
}

