import { Crosshair, Loader2 } from 'lucide-react';

export default function LocationDetectButton({ onDetect, loading, error, label = 'Use my current location' }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onDetect}
        disabled={loading}
        className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {loading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Detecting…
          </>
        ) : (
          <>
            <Crosshair className="w-3.5 h-3.5" />
            {label}
          </>
        )}
      </button>
      {error && (
        <p className="text-xs text-amber-600 text-right max-w-[220px] leading-snug">{error}</p>
      )}
    </div>
  );
}
