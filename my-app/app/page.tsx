'use client';

import Map from './components/Map';

export default function Home() {
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Map fills the entire screen */}
      <Map />
      
      {/* Header overlay */}
      <header className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div className="flex items-center justify-between p-6">
          <div className="pointer-events-auto">
            <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-lg">
              <span className="text-amber-400">NYC</span> Parking Predictor
            </h1>
            <p className="text-sm text-slate-300 mt-1 drop-shadow-md">
              Prediction model under development
            </p>
          </div>
        </div>
      </header>

      {/* Bottom info panel */}
      <div className="absolute bottom-6 left-6 z-10">
        <div className="bg-slate-900/90 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 max-w-sm shadow-xl">
          <h2 className="text-lg font-semibold text-white mb-2">
            <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
            XGBoost Model Active
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Displaying parking ticket predictions based on historical data. The heatmap shows areas with the highest likelihood of receiving a ticket.
          </p>
        </div>
      </div>
    </div>
  );
}
