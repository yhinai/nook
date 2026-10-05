"use client";

import { useEffect, useRef, useState } from 'react';
import { approximateLocation, currentLocation, locationLifetime, type SharedLocation } from './location';

export function useLocation() {
  const [location, setLocation] = useState<SharedLocation | null>(null);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'enabled' | 'error'>('idle');
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const generation = useRef(0);
  const requesting = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let permission: PermissionStatus | undefined;
    const revoked = () => {
      if (permission?.state !== 'denied') return;
      generation.current++; requesting.current = false;
      setLocation(null); setStatus('error');
      setError('Location permission is blocked. Allow it in your browser settings or tell Nook your city.');
    };
    if (navigator.permissions?.query) void navigator.permissions.query({ name: 'geolocation' }).then(result => {
      if (cancelled) return;
      permission = result; permission.addEventListener('change', revoked);
    }).catch(() => {});
    return () => { cancelled = true; generation.current++; permission?.removeEventListener('change', revoked); };
  }, []);
  useEffect(() => {
    if (!location) return;
    const timer = setTimeout(() => { setLocation(null); setStatus('idle'); }, Math.max(0, locationLifetime - (Date.now() - Date.parse(location.capturedAt))));
    return () => clearTimeout(timer);
  }, [location]);
  const disable = () => {
    generation.current++; requesting.current = false;
    setLocation(null); setStatus('idle'); setError(''); setDismissed(true);
  };
  const request = () => {
    if (requesting.current) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      setStatus('error'); setError('Location is unavailable in this browser. You can tell Nook your city in chat.'); return;
    }
    const id = ++generation.current;
    requesting.current = true; setLocation(null); setStatus('requesting'); setError('');
    navigator.geolocation.getCurrentPosition(position => {
      if (generation.current !== id) return;
      requesting.current = false;
      try { setLocation(approximateLocation(position)); setStatus('enabled'); setDismissed(true); }
      catch { setStatus('error'); setError('The browser returned an invalid location. Try again or tell Nook your city.'); }
    }, failure => {
      if (generation.current !== id) return;
      requesting.current = false; setStatus('error');
      setError(failure.code === 1 ? 'Location permission was denied. Allow it in your browser settings or tell Nook your city in chat.' : failure.code === 3 ? 'Finding your location took too long. Try again or tell Nook your city.' : 'Your location could not be found. Try again or tell Nook your city.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
  };
  return { location, status, error, dismissed, request, disable, forRequest: () => currentLocation(location) };
}
