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

    </div>
  );
}
