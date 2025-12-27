'use client';

import { useState } from 'react';
import Map from './components/Map';

interface PredictionData {
  as_of: string;
  bucket: {
    dow: number;
    hour: number;
    dow_name: string;
    hour_display: string;
  };
  train_days: number;
  rows_used: number;
  features: Array<{
    properties: {
      precinct: string;
      expected_tickets: number;
      intensity: string;
    };
  }>;
}

export default function Home() {
  const [predictionData, setPredictionData] = useState<PredictionData | null>(null);

  const handlePredictionLoad = (data: PredictionData | null) => {
    setPredictionData(data);
  };

  // Get top hotspots from prediction data
  const topHotspots = predictionData?.features
    .slice(0, 5)
    .map((f) => f.properties) || [];

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Map fills the entire screen */}
      <Map onPredictionLoad={handlePredictionLoad} />
      
      {/* Header overlay */}
      <header className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div className="flex items-center justify-between p-6">
          <div className="pointer-events-auto">
            <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-lg">
              <span className="text-amber-400">NYC</span> Parking Predictor
            </h1>
            {predictionData && (
              <p className="text-sm text-slate-300 mt-1 drop-shadow-md">
                Predictions for <span className="text-amber-400 font-medium">
                  {predictionData.bucket.dow_name}s @ {predictionData.bucket.hour_display}
                </span>
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Bottom info panel */}
      <div className="absolute bottom-6 left-6 z-10">
        <div className="bg-slate-900/90 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 max-w-sm shadow-xl">
          {predictionData ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-white">Ticket Hotspots</h2>
                <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">
                  {predictionData.rows_used.toLocaleString()} samples
                </span>
              </div>
              
              <p className="text-xs text-slate-400 mb-4">
                Based on {predictionData.train_days} days of historical data for this time slot
              </p>

              {/* Top hotspots list */}
              <div className="space-y-2 mb-4">
                {topHotspots.map((spot, i) => (
                  <div 
                    key={spot.precinct} 
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-slate-800/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-4">{i + 1}</span>
                      <span className="text-sm text-white font-medium">
                        Precinct {spot.precinct}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">
                        {spot.expected_tickets.toFixed(0)} tickets/hr
                      </span>
                      <div 
                        className={`w-2 h-2 rounded-full ${
                          spot.intensity === 'very_high' ? 'bg-red-500' :
                          spot.intensity === 'high' ? 'bg-red-400' :
                          spot.intensity === 'medium' ? 'bg-amber-500' :
                          'bg-emerald-500'
                        }`}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="flex gap-3 pt-3 border-t border-slate-700/50">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                  <span>High</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                  <span>Medium</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                  <span>Low</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-white mb-2">Loading Predictions...</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Analyzing historical ticket data to predict high-risk areas for the current time.
              </p>
              <div className="mt-4 flex justify-center">
                <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Time indicator */}
      {predictionData && (
        <div className="absolute bottom-6 right-6 z-10">
          <div className="bg-slate-900/90 backdrop-blur-sm rounded-xl px-4 py-3 border border-slate-700/50 shadow-xl">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Showing data for</div>
            <div className="text-lg font-semibold text-white">
              {predictionData.bucket.dow_name}
            </div>
            <div className="text-2xl font-bold text-amber-400">
              {predictionData.bucket.hour_display}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
