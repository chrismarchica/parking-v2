import { NextResponse } from 'next/server';
import { getModelInfo } from '@/lib/xgboost-api';

/**
 * GET /api/predictions/model
 * 
 * Get model information and feature importance from the XGBoost API.
 */
export async function GET() {
  try {
    const result = await getModelInfo();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Model info error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch model info' },
      { status: 500 }
    );
  }
}

