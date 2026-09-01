import { useState, useCallback } from 'react';
import { detectLocation } from '../utils/geolocation';

export default function useLocationDetector() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const detect = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await detectLocation();
      setLoading(false);
      return result;
    } catch (err) {
      setLoading(false);
      const code = err && err.code;
      let msg = err?.message || "Couldn't detect location — please enter manually";
      if (code === 1) msg = 'Location permission denied. Please enter manually.';
      else if (code === 2) msg = 'Location unavailable. Please enter manually.';
      else if (code === 3) msg = 'Location request timed out. Please try again.';
      setError(msg);
      return null;
    }
  }, []);

  return { detect, loading, error, clearError: () => setError('') };
}
