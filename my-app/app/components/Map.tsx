'use client';

import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { VIOLATION_CODES, violationLabel } from '@/lib/violation-codes';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// NYC coordinates
const NYC_CENTER: [number, number] = [-73.985, 40.748];
const DEFAULT_ZOOM = 11;

// NYC bounding box (matches server-side validation in the predict route)
const NYC_BOUNDS = { minLat: 40.4, maxLat: 41.0, minLon: -74.3, maxLon: -73.7 };

interface MapProps {
  onPredictionLoad?: (data: null) => void;
}

interface HeatmapPoint {
  latitude: number;
  longitude: number;
  violation_code: string;
}

interface HeatmapResponse {
  points: HeatmapPoint[];
  count: number;
}

interface PredictionItem {
  violation_code: string;
  probability: number;
}

interface PredictResponse {
  predicted_violation: string;
  confidence: number;
  top_predictions: PredictionItem[];
}

export default function Map({ onPredictionLoad }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoadingHeatmap, setIsLoadingHeatmap] = useState(false);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);

  // Prediction state
  const [prediction, setPrediction] = useState<PredictResponse | null>(null);
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);

  // Request a prediction for a clicked location
  const predictAt = async (lng: number, lat: number) => {
    // Drop / move a marker at the clicked point
    if (!marker.current) {
      marker.current = new mapboxgl.Marker({ color: '#f59e0b' });
    }
    marker.current.setLngLat([lng, lat]).addTo(map.current!);

    setPrediction(null);
    setPredictError(null);
    setIsPredicting(true);

    try {
      const response = await fetch('/api/predictions/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Prediction failed: ${response.statusText}`);
      }
      setPrediction(data as PredictResponse);
    } catch (error) {
      console.error('Error predicting:', error);
      setPredictError(error instanceof Error ? error.message : 'Prediction failed');
    } finally {
      setIsPredicting(false);
    }
  };

  // Fetch and display heatmap data
  const loadHeatmap = async () => {
    if (!map.current) return;

    setIsLoadingHeatmap(true);
    setHeatmapError(null);

    try {
      // Fetch heatmap data from the API
      const response = await fetch('/api/predictions/heatmap?limit=10000');
      if (!response.ok) {
        throw new Error(`Failed to fetch heatmap data: ${response.statusText}`);
      }

      const data: HeatmapResponse = await response.json();
      
      if (!data.points || data.points.length === 0) {
        throw new Error('No heatmap data available');
      }

      // Convert to GeoJSON format
      const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: 'FeatureCollection',
        features: data.points.map((point) => ({
          type: 'Feature',
          properties: {
            violation_code: point.violation_code,
          },
          geometry: {
            type: 'Point',
            coordinates: [point.longitude, point.latitude],
          },
        })),
      };

      // Remove existing layers and sources if they exist
      if (map.current?.getLayer('heatmap-layer')) {
        map.current.removeLayer('heatmap-layer');
      }
      if (map.current?.getLayer('heatmap-points')) {
        map.current.removeLayer('heatmap-points');
      }
      if (map.current?.getSource('heatmap-data')) {
        map.current.removeSource('heatmap-data');
      }

      // Add source
      map.current?.addSource('heatmap-data', {
        type: 'geojson',
        data: geojson,
      });

      // Add heatmap layer
      map.current?.addLayer({
        id: 'heatmap-layer',
        type: 'heatmap',
        source: 'heatmap-data',
        maxzoom: 15,
        paint: {
          // Increase weight as density increases
          'heatmap-weight': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 0.5,
            15, 1
          ],
          // Increase intensity as zoom level increases
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 0.5,
            15, 1.5
          ],
          // Color ramp for heatmap (blue -> cyan -> lime -> yellow -> red)
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(33,102,172,0)',
            0.2, 'rgb(103,169,207)',
            0.4, 'rgb(209,229,240)',
            0.6, 'rgb(253,219,199)',
            0.8, 'rgb(239,138,98)',
            1, 'rgb(178,24,43)'
          ],
          // Adjust radius by zoom level
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 2,
            9, 10,
            15, 20
          ],
          // Transition from heatmap to circle layer by zoom level
          'heatmap-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            7, 0.8,
            13, 0.6,
            15, 0
          ],
        },
      });

      // Add circle layer for when zoomed in
      map.current?.addLayer({
        id: 'heatmap-points',
        type: 'circle',
        source: 'heatmap-data',
        minzoom: 13,
        paint: {
          // Size circle radius by zoom level
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 2,
            16, 6
          ],
          // Color circles by violation type (or use a single color)
          'circle-color': '#ff6b6b',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1,
          'circle-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 0,
            15, 0.8
          ]
        }
      });

      console.log(`Loaded ${data.count} heatmap points`);
      onPredictionLoad?.(null);
    } catch (error) {
      console.error('Error loading heatmap:', error);
      setHeatmapError(error instanceof Error ? error.message : 'Failed to load heatmap');
    } finally {
      setIsLoadingHeatmap(false);
    }
  };

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    if (!MAPBOX_TOKEN) {
      console.error('Mapbox token not found');
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: NYC_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    map.current.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      'top-right'
    );

    map.current.on('load', () => {
      setIsLoaded(true);
      // Load heatmap data once map is ready
      loadHeatmap();
    });

    // Signal that the map is clickable for predictions
    map.current.getCanvas().style.cursor = 'crosshair';

    // Click anywhere in NYC to predict the most likely violation there
    map.current.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      if (
        lat < NYC_BOUNDS.minLat || lat > NYC_BOUNDS.maxLat ||
        lng < NYC_BOUNDS.minLon || lng > NYC_BOUNDS.maxLon
      ) {
        setPredictError('Click within New York City to get a prediction.');
        setPrediction(null);
        return;
      }
      predictAt(lng, lat);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [onPredictionLoad]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
        <div className="text-center p-8 max-w-md">
          <div className="text-6xl mb-4">🗺️</div>
          <h2 className="text-xl font-semibold text-white mb-2">Mapbox Token Required</h2>
          <p className="text-slate-400 text-sm">
            Create a <code className="bg-slate-800 px-2 py-1 rounded">.env.local</code> file with:
          </p>
          <code className="block mt-3 bg-slate-800 p-3 rounded text-amber-400 text-sm">
            NEXT_PUBLIC_MAPBOX_TOKEN=your_token_here
          </code>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
      
      {/* Map loading indicator */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-50">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Loading map...</span>
          </div>
        </div>
      )}

      {/* Heatmap loading indicator */}
      {isLoaded && isLoadingHeatmap && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-20">
          <div className="bg-slate-900/90 backdrop-blur-sm rounded-lg px-4 py-3 border border-slate-700/50 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-slate-300 text-sm">Loading heatmap data...</span>
            </div>
          </div>
        </div>
      )}

      {/* Heatmap error indicator */}
      {isLoaded && heatmapError && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-20">
          <div className="bg-red-900/90 backdrop-blur-sm rounded-lg px-4 py-3 border border-red-700/50 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="text-red-200 text-sm">⚠️ {heatmapError}</span>
              <button
                onClick={loadHeatmap}
                className="ml-2 text-xs bg-red-800 hover:bg-red-700 px-2 py-1 rounded transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click-to-predict hint */}
      {isLoaded && !prediction && !isPredicting && !predictError && (
        <div className="absolute top-6 left-6 z-20 max-w-xs">
          <div className="bg-slate-900/90 backdrop-blur-sm rounded-lg p-4 border border-amber-500/30 shadow-xl">
            <h2 className="text-white text-sm font-semibold mb-1 flex items-center gap-2">
              <span>🎯</span> Predict a violation
            </h2>
            <p className="text-slate-400 text-xs leading-relaxed">
              Click anywhere in NYC and an XGBoost model predicts the most likely
              parking violation for that spot, given the current day and time.
            </p>
          </div>
        </div>
      )}

      {/* Prediction panel */}
      {isLoaded && (isPredicting || prediction || predictError) && (
        <div className="absolute top-6 left-6 z-30 w-80 max-w-[calc(100vw-3rem)]">
          <div className="bg-slate-900/95 backdrop-blur-sm rounded-lg border border-slate-700/60 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
              <h2 className="text-white text-sm font-semibold flex items-center gap-2">
                <span>🎯</span> Violation Prediction
              </h2>
              <button
                onClick={() => {
                  setPrediction(null);
                  setPredictError(null);
                  marker.current?.remove();
                }}
                className="text-slate-400 hover:text-white text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              {isPredicting && (
                <div className="flex items-center gap-3 py-2">
                  <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-slate-300 text-sm">
                    Running model… <span className="text-slate-500">(first call may take a few seconds)</span>
                  </span>
                </div>
              )}

              {!isPredicting && predictError && (
                <p className="text-red-300 text-sm">⚠️ {predictError}</p>
              )}

              {!isPredicting && prediction && (
                <>
                  <div className="mb-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Most likely</p>
                    <p className="text-white text-lg font-semibold leading-tight">
                      {violationLabel(prediction.predicted_violation)}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span>Code #{prediction.predicted_violation}</span>
                      <span>·</span>
                      <span>{(prediction.confidence * 100).toFixed(1)}% confidence</span>
                      {VIOLATION_CODES[prediction.predicted_violation]?.fineOther != null && (
                        <>
                          <span>·</span>
                          <span className="text-amber-400">
                            ~${VIOLATION_CODES[prediction.predicted_violation]!.fineOther} fine
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Top predictions</p>
                  <ul className="space-y-2">
                    {prediction.top_predictions.map((item) => (
                      <li key={item.violation_code}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-300 truncate pr-2">
                            {violationLabel(item.violation_code)}
                          </span>
                          <span className="text-slate-400 tabular-nums shrink-0">
                            {(item.probability * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-red-500 rounded-full"
                            style={{ width: `${Math.max(2, item.probability * 100)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      {isLoaded && !isLoadingHeatmap && !heatmapError && (
        <div className="absolute bottom-6 right-6 z-10">
          <div className="bg-slate-900/90 backdrop-blur-sm rounded-lg p-4 border border-slate-700/50 shadow-xl">
            <h3 className="text-white text-sm font-semibold mb-3">Ticket Density</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Low</span>
              <div className="w-32 h-3 rounded" style={{
                background: 'linear-gradient(to right, rgb(103,169,207), rgb(209,229,240), rgb(253,219,199), rgb(239,138,98), rgb(178,24,43))'
              }} />
              <span className="text-xs text-slate-400">High</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Zoom in to see individual tickets
            </p>
          </div>
        </div>
      )}
    </>
  );
}
