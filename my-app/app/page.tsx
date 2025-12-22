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
              Real-time parking ticket risk analysis
            </p>
          </div>
          
          <div className="pointer-events-auto flex items-center gap-2 bg-slate-900/80 backdrop-blur-sm px-4 py-2 rounded-full border border-slate-700/50">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-sm text-slate-300">Live</span>
          </div>
        </div>
      </header>

      {/* Bottom info panel */}
      <div className="absolute bottom-6 left-6 z-10">
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50 max-w-sm">
          <h2 className="text-lg font-semibold text-white mb-2">Coming Soon</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            This map will display historical parking ticket data and predict high-risk areas 
            for parking violations across New York City.
          </p>
          <div className="mt-4 flex gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-3 h-3 rounded-full bg-red-500/60"></div>
              <span>High Risk</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-3 h-3 rounded-full bg-amber-500/60"></div>
              <span>Medium</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-3 h-3 rounded-full bg-emerald-500/60"></div>
              <span>Low Risk</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
