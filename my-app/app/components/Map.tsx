'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// NYC coordinates
const NYC_CENTER: [number, number] = [-73.985, 40.748];
const DEFAULT_ZOOM = 11;

// Prediction data types
interface PredictionFeature {
  type: 'Feature';
  properties: {
    precinct: string;
    name: string;
    borough: string;
    expected_tickets: number;
    score: number;
    intensity: 'low' | 'medium' | 'high' | 'very_high';
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

interface PredictionData {
  type: 'FeatureCollection';
  as_of: string;
  bucket: {
    dow: number;
    hour: number;
    dow_name: string;
    hour_display: string;
  };
  train_days: number;
  rows_used: number;
  features: PredictionFeature[];
}

// Color mapping for intensity
const INTENSITY_COLORS: Record<string, string> = {
  low: '#10b981',      // emerald-500
  medium: '#f59e0b',   // amber-500
  high: '#ef4444',     // red-500
  very_high: '#dc2626', // red-600
};

interface MapProps {
  onPredictionLoad?: (data: PredictionData | null) => void;
}

export default function Map({ onPredictionLoad }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const popup = useRef<mapboxgl.Popup | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [predictions, setPredictions] = useState<PredictionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch prediction data
  const fetchPredictions = useCallback(async () => {
    try {
      // Use a date with data for demo (or use current time when you have recent data)
      const response = await fetch('/api/predictions/map?limit=50&trainDays=90');
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data: PredictionData = await response.json();
      setPredictions(data);
      onPredictionLoad?.(data);
      return data;
    } catch (err) {
      console.error('Failed to fetch predictions:', err);
      setError('Failed to load prediction data');
      onPredictionLoad?.(null);
      return null;
    }
  }, [onPredictionLoad]);

  // Add prediction layer to map
  const addPredictionLayer = useCallback((mapInstance: mapboxgl.Map, data: PredictionData) => {
    // Remove existing layers/sources if they exist
    if (mapInstance.getLayer('predictions-circle')) {
      mapInstance.removeLayer('predictions-circle');
    }
    if (mapInstance.getLayer('predictions-label')) {
      mapInstance.removeLayer('predictions-label');
    }
    if (mapInstance.getSource('predictions')) {
      mapInstance.removeSource('predictions');
    }

    // Add source
    mapInstance.addSource('predictions', {
      type: 'geojson',
      data: data as unknown as GeoJSON.FeatureCollection,
    });

    // Add circle layer with size based on expected tickets
    mapInstance.addLayer({
      id: 'predictions-circle',
      type: 'circle',
      source: 'predictions',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['get', 'expected_tickets'],
          0, 15,
          20, 25,
          50, 35,
          100, 45,
        ],
        'circle-color': [
          'match', ['get', 'intensity'],
          'low', INTENSITY_COLORS.low,
          'medium', INTENSITY_COLORS.medium,
          'high', INTENSITY_COLORS.high,
          'very_high', INTENSITY_COLORS.very_high,
          '#888888',
        ],
        'circle-opacity': 0.7,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.9,
      },
    });

    // Add label layer
    mapInstance.addLayer({
      id: 'predictions-label',
      type: 'symbol',
      source: 'predictions',
      layout: {
        'text-field': ['get', 'precinct'],
        'text-size': 12,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
        'text-anchor': 'center',
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    });

    // Add click handler for popups
    mapInstance.on('click', 'predictions-circle', (e) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const props = feature.properties as PredictionFeature['properties'];
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

      // Remove existing popup
      popup.current?.remove();

      // Create new popup
      popup.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: true,
        maxWidth: '280px',
      })
        .setLngLat(coords)
        .setHTML(`
          <div style="font-family: system-ui, sans-serif; padding: 4px;">
            <div style="font-size: 16px; font-weight: 600; color: #1e293b; margin-bottom: 4px;">
              ${props.name}
            </div>
            <div style="font-size: 12px; color: #64748b; margin-bottom: 8px;">
              Precinct ${props.precinct} • ${props.borough}
            </div>
            <div style="display: flex; gap: 16px; margin-top: 8px;">
              <div>
                <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Expected</div>
                <div style="font-size: 18px; font-weight: 600; color: #0f172a;">
                  ${props.expected_tickets.toFixed(1)}
                </div>
                <div style="font-size: 10px; color: #94a3b8;">tickets/hour</div>
              </div>
              <div>
                <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">Risk</div>
                <div style="font-size: 14px; font-weight: 500; color: ${INTENSITY_COLORS[props.intensity] || '#888'}; text-transform: capitalize;">
                  ${props.intensity.replace('_', ' ')}
                </div>
              </div>
            </div>
          </div>
        `)
        .addTo(mapInstance);
    });

    // Change cursor on hover
    mapInstance.on('mouseenter', 'predictions-circle', () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    });
    mapInstance.on('mouseleave', 'predictions-circle', () => {
      mapInstance.getCanvas().style.cursor = '';
    });
  }, []);

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

    map.current.on('load', async () => {
      setIsLoaded(true);
      
      // Fetch and display predictions
      const data = await fetchPredictions();
      if (data && map.current) {
        addPredictionLayer(map.current, data);
      }
    });

    return () => {
      popup.current?.remove();
      map.current?.remove();
      map.current = null;
    };
  }, [fetchPredictions, addPredictionLayer]);

  // Update predictions when data changes
  useEffect(() => {
    if (map.current && isLoaded && predictions) {
      addPredictionLayer(map.current, predictions);
    }
  }, [predictions, isLoaded, addPredictionLayer]);

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
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-50">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Loading map...</span>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 text-red-200 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}
    </>
  );
}
