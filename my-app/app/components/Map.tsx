'use client';

import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// NYC coordinates
const NYC_CENTER: [number, number] = [-73.985, 40.748];
const DEFAULT_ZOOM = 11;
const NYC_BBOX = '-74.3,40.45,-73.65,40.95';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface HeatmapPoint {
  latitude: number;
  longitude: number;
  violation_code: string;
}

interface HeatmapResponse {
  points: HeatmapPoint[];
  count: number;
}

interface HourRisk {
  hour: number;
  risk: number;
}

interface RiskResponse {
  risk_score: number;
  level: string;
  factors: string[];
  hourly: HourRisk[];
}

interface RiskResult extends RiskResponse {
  place: string;
  lat: number;
  lon: number;
  dow: number;
}

// Build a local (no timezone) datetime string whose weekday === dow (Sun=0).
function dateForDow(dow: number): string {
  const now = new Date();
  const delta = (dow - now.getDay() + 7) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta, 12, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`;
}

function riskColor(risk: number): string {
  // 0 -> green, 50 -> amber, 100 -> red
  const hue = Math.round(120 - (risk / 100) * 120);
  return `hsl(${hue}, 80%, 50%)`;
}

function formatHour(h: number): string {
  const ampm = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}

export default function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Address / risk state
  const [address, setAddress] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RiskResult | null>(null);
  const [selectedDow, setSelectedDow] = useState<number>(new Date().getDay());
  const [selectedHour, setSelectedHour] = useState<number>(new Date().getHours());

  // Fetch risk for a location + day of week; returns the API payload.
  const fetchRisk = async (lat: number, lon: number, dow: number): Promise<RiskResponse> => {
    const res = await fetch('/api/predictions/risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: lat, longitude: lon, datetime: dateForDow(dow) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Risk request failed');
    return data as RiskResponse;
  };

  const runSearch = async () => {
    const query = address.trim();
    if (!query) return;
    setIsSearching(true);
    setError(null);
    try {
      // Geocode the address with Mapbox, biased to NYC.
      const geoUrl =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
        `?access_token=${MAPBOX_TOKEN}&bbox=${NYC_BBOX}&proximity=-73.98,40.75&limit=1&country=US`;
      const geoRes = await fetch(geoUrl);
      const geo = await geoRes.json();
      if (!geo.features || geo.features.length === 0) {
        throw new Error('Could not find that address in NYC. Try adding a borough.');
      }
      const [lon, lat] = geo.features[0].center as [number, number];
      const place = geo.features[0].place_name as string;

      const dow = new Date().getDay();
      const risk = await fetchRisk(lat, lon, dow);

      // Move map + marker to the location
      map.current?.flyTo({ center: [lon, lat], zoom: 15, duration: 1200 });
      if (!marker.current) marker.current = new mapboxgl.Marker({ color: '#f59e0b' });
      marker.current.setLngLat([lon, lat]).addTo(map.current!);

      setSelectedDow(dow);
      setSelectedHour(new Date().getHours());
      setResult({ ...risk, place, lat, lon, dow });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Search failed');
      setResult(null);
    } finally {
      setIsSearching(false);
    }
  };

  // Re-query when the user picks a different day of week
  const selectDay = async (dow: number) => {
    if (!result) return;
    setSelectedDow(dow);
    try {
      const risk = await fetchRisk(result.lat, result.lon, dow);
      setResult({ ...result, ...risk, dow });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Risk request failed');
    }
  };

  // Load heatmap once the map is ready (background context layer)
  const loadHeatmap = async () => {
    if (!map.current) return;
    try {
      const response = await fetch('/api/predictions/heatmap?limit=10000');
      if (!response.ok) return;
      const data: HeatmapResponse = await response.json();
      if (!data.points?.length) return;

      const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: 'FeatureCollection',
        features: data.points.map((p) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
        })),
      };

      if (map.current?.getSource('heatmap-data')) return;
      map.current?.addSource('heatmap-data', { type: 'geojson', data: geojson });
      map.current?.addLayer({
        id: 'heatmap-layer',
        type: 'heatmap',
        source: 'heatmap-data',
        maxzoom: 15,
        paint: {
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 15, 1.5],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(33,102,172,0)',
            0.2, 'rgb(103,169,207)',
            0.4, 'rgb(209,229,240)',
            0.6, 'rgb(253,219,199)',
            0.8, 'rgb(239,138,98)',
            1, 'rgb(178,24,43)',
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 9, 10, 15, 20],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 13, 0.4, 15, 0],
        },
      });
    } catch (err) {
      console.error('Error loading heatmap:', err);
    }
  };

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: NYC_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.current.on('load', () => {
      setIsLoaded(true);
      loadHeatmap();
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
        <div className="text-center p-8 max-w-md">
          <div className="text-6xl mb-4">🗺️</div>
          <h2 className="text-xl font-semibold text-white mb-2">Mapbox Token Required</h2>
          <code className="block mt-3 bg-slate-800 p-3 rounded text-amber-400 text-sm">
            NEXT_PUBLIC_MAPBOX_TOKEN=your_token_here
          </code>
        </div>
      </div>
    );
  }

  const shownRisk = result ? (result.hourly[selectedHour]?.risk ?? result.risk_score) : 0;
  const peak = result ? [...result.hourly].sort((a, b) => b.risk - a.risk)[0] : null;

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

      {/* Control panel */}
      {isLoaded && (
        <div className="absolute top-4 left-4 z-30 w-[22rem] max-w-[calc(100vw-2rem)]">
          <div className="bg-slate-900/95 backdrop-blur-sm rounded-xl border border-slate-700/60 shadow-2xl overflow-hidden">
            {/* Header + search */}
            <div className="p-4 border-b border-slate-700/60">
              <h1 className="text-white text-base font-semibold flex items-center gap-2 mb-1">
                <span>🅿️</span> NYC Parking Ticket Risk
              </h1>
              <p className="text-slate-400 text-xs mb-3">
                Enter where you want to park — an XGBoost model scores how likely a ticket is,
                by location and time.
              </p>
              <div className="flex gap-2">
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                  placeholder="e.g. 350 5th Ave, Manhattan"
                  className="flex-1 bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-amber-500 focus:outline-none placeholder:text-slate-500"
                />
                <button
                  onClick={runSearch}
                  disabled={isSearching}
                  className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 text-sm font-semibold rounded-lg px-4 py-2 transition-colors"
                >
                  {isSearching ? '…' : 'Check'}
                </button>
              </div>
              {error && <p className="text-red-300 text-xs mt-2">⚠️ {error}</p>}
            </div>

            {/* Result */}
            {result && (
              <div className="p-4">
                <p className="text-slate-400 text-xs mb-3 truncate" title={result.place}>
                  📍 {result.place}
                </p>

                {/* Score */}
                <div className="flex items-end gap-3 mb-1">
                  <span
                    className="text-5xl font-bold tabular-nums leading-none"
                    style={{ color: riskColor(shownRisk) }}
                  >
                    {Math.round(shownRisk)}
                  </span>
                  <div className="pb-1">
                    <div className="text-white text-sm font-semibold">
                      {shownRisk >= 75 ? 'Very High' : shownRisk >= 50 ? 'High' : shownRisk >= 25 ? 'Moderate' : 'Low'} risk
                    </div>
                    <div className="text-slate-500 text-xs">
                      {DAY_LABELS[selectedDow]} · {formatHour(selectedHour)}
                    </div>
                  </div>
                </div>
                {peak && (
                  <p className="text-slate-400 text-xs mb-3">
                    Riskiest around <span className="text-slate-200">{formatHour(peak.hour)}</span> ({Math.round(peak.risk)})
                  </p>
                )}

                {/* Day selector */}
                <div className="flex gap-1 mb-3">
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={d}
                      onClick={() => selectDay(i)}
                      className={`flex-1 text-xs py-1 rounded transition-colors ${
                        i === selectedDow
                          ? 'bg-amber-500 text-slate-900 font-semibold'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                {/* 24-hour risk chart */}
                <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Risk by hour</p>
                <div className="flex items-end gap-[2px] h-16 mb-1">
                  {result.hourly.map((h) => (
                    <button
                      key={h.hour}
                      onClick={() => setSelectedHour(h.hour)}
                      title={`${formatHour(h.hour)}: ${Math.round(h.risk)}`}
                      className="flex-1 rounded-sm transition-opacity hover:opacity-80"
                      style={{
                        height: `${Math.max(4, h.risk)}%`,
                        backgroundColor: riskColor(h.risk),
                        outline: h.hour === selectedHour ? '2px solid white' : 'none',
                      }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[9px] text-slate-600">
                  <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
                </div>

                {/* Factors */}
                {result.factors.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {result.factors.map((f) => (
                      <li key={f} className="text-slate-300 text-xs flex gap-2">
                        <span className="text-amber-400">•</span> {f}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-slate-600 text-[10px] mt-3 leading-snug">
                  Relative risk index (0–100) from historical ticket patterns — not a
                  guaranteed probability.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Heatmap legend */}
      {isLoaded && (
        <div className="absolute bottom-6 right-6 z-10">
          <div className="bg-slate-900/90 backdrop-blur-sm rounded-lg p-3 border border-slate-700/50 shadow-xl">
            <h3 className="text-white text-xs font-semibold mb-2">Historical ticket density</h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">Low</span>
              <div className="w-24 h-2 rounded" style={{
                background: 'linear-gradient(to right, rgb(103,169,207), rgb(253,219,199), rgb(178,24,43))'
              }} />
              <span className="text-[10px] text-slate-400">High</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
