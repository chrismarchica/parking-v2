/**
 * XGBoost Prediction API Client
 * 
 * Client for interacting with the Flask-based XGBoost parking ticket prediction API.
 */

const XGBOOST_API_URL = process.env.XGBOOST_API_URL || 'http://localhost:5000';

// ============================================================================
// Types
// ============================================================================

export interface HealthResponse {
  status: string;
  model_loaded: boolean;
  timestamp: string;
}

export interface PredictRequest {
  latitude: number;
  longitude: number;
  datetime?: string;  // ISO format, defaults to now on server
  precinct?: string;
  county?: string;
}

export interface PredictionItem {
  violation_code: string;
  probability: number;
}

export interface PredictResponse {
  predicted_violation: string;
  confidence: number;
  top_predictions: PredictionItem[];
  input: PredictRequest;
}

export interface ViolationStats {
  violation_code: string;
  violation_desc: string;
  ticket_count: number;
  precinct_count: number;
  avg_fine: number;
  first_ticket: string;
  last_ticket: string;
}

export interface ViolationsStatsResponse {
  violations: ViolationStats[];
  total_count: number;
}

export interface Hotspot {
  precinct: string;
  county: string;
  ticket_count: number;
  violation_types: number;
  avg_fine: number;
  total_fines: number;
}

export interface HotspotsResponse {
  hotspots: Hotspot[];
  total_locations: number;
}

export interface TemporalRecord {
  day_of_week: number;  // 0=Sunday, 6=Saturday
  hour_of_day: number;
  ticket_count: number;
}

export interface TemporalDistributionResponse {
  distribution: TemporalRecord[];
  total_records: number;
}

export interface HeatmapPoint {
  latitude: number;
  longitude: number;
  violation_code: string;
}

export interface HeatmapFilters {
  start_date?: string;
  end_date?: string;
  violation_code?: string;
}

export interface HeatmapResponse {
  points: HeatmapPoint[];
  count: number;
  filters: HeatmapFilters;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
}

export interface ModelInfoResponse {
  target: string;
  features: string[];
  num_classes: number;
  top_features: FeatureImportance[];
}

// ============================================================================
// API Client Class
// ============================================================================

class XGBoostApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public endpoint?: string
  ) {
    super(message);
    this.name = 'XGBoostApiError';
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${XGBOOST_API_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new XGBoostApiError(
        `API request failed: ${errorText}`,
        response.status,
        endpoint
      );
    }

    return await response.json() as T;
  } catch (error) {
    if (error instanceof XGBoostApiError) {
      throw error;
    }
    throw new XGBoostApiError(
      `Failed to connect to XGBoost API: ${error instanceof Error ? error.message : 'Unknown error'}`,
      undefined,
      endpoint
    );
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Check API health status
 */
export async function checkHealth(): Promise<HealthResponse> {
  return fetchApi<HealthResponse>('/health');
}

/**
 * Get prediction for a location and time
 */
export async function getPrediction(request: PredictRequest): Promise<PredictResponse> {
  return fetchApi<PredictResponse>('/predict', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Get violation statistics
 */
export async function getViolationStats(): Promise<ViolationsStatsResponse> {
  return fetchApi<ViolationsStatsResponse>('/violations/stats');
}

/**
 * Get location hotspots
 */
export async function getHotspots(): Promise<HotspotsResponse> {
  return fetchApi<HotspotsResponse>('/locations/hotspots');
}

/**
 * Get temporal distribution of tickets
 */
export async function getTemporalDistribution(): Promise<TemporalDistributionResponse> {
  return fetchApi<TemporalDistributionResponse>('/temporal/distribution');
}

/**
 * Get heatmap data with optional filters
 */
export async function getHeatmapData(
  options: {
    startDate?: string;
    endDate?: string;
    violationCode?: string;
    limit?: number;
  } = {}
): Promise<HeatmapResponse> {
  const params = new URLSearchParams();
  
  if (options.startDate) params.set('start_date', options.startDate);
  if (options.endDate) params.set('end_date', options.endDate);
  if (options.violationCode) params.set('violation_code', options.violationCode);
  if (options.limit) params.set('limit', options.limit.toString());

  const queryString = params.toString();
  const endpoint = queryString ? `/heatmap/data?${queryString}` : '/heatmap/data';
  
  return fetchApi<HeatmapResponse>(endpoint);
}

/**
 * Get model information and feature importance
 */
export async function getModelInfo(): Promise<ModelInfoResponse> {
  return fetchApi<ModelInfoResponse>('/model/info');
}

// ============================================================================
// Convenience Exports
// ============================================================================

export const xgboostApi = {
  checkHealth,
  getPrediction,
  getViolationStats,
  getHotspots,
  getTemporalDistribution,
  getHeatmapData,
  getModelInfo,
};

export { XGBoostApiError };

