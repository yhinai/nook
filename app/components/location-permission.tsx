"use client";

import { MapPin, X } from 'lucide-react';
import type { useLocation } from '@/lib/use-location';

type Props = { control: ReturnType<typeof useLocation>; settings?: boolean };
export function LocationPermission({ control, settings = false }: Props) {
  if (!settings && control.dismissed) return null;
  return <section className={`location-permission ${settings ? 'location-settings' : ''}`} aria-label="Location sharing">
    <MapPin size={20} aria-hidden="true" />
    <div><h3>{control.status === 'enabled' ? 'Location is on for this session' : 'Find things near you?'}</h3><p>{control.status === 'enabled' ? 'Nook uses your approximate location for nearby suggestions. Refresh it after moving; sharing expires after 15 minutes.' : 'Allow location to help your Twin find nearby places. Approximate coordinates are shared with Nook’s AI and may be used in web searches for this session. You can also type a city in chat.'}</p>
      {control.error && <p className="location-error" role="alert">{control.error}</p>}
      <div className="location-actions">{control.status === 'enabled' ? <><button type="button" className="text-button" onClick={control.request}>Refresh location</button><button type="button" className="text-button" onClick={control.disable}>Stop sharing</button></> : <><button type="button" className="secondary-button" disabled={control.status === 'requesting'} onClick={control.request}>{control.status === 'requesting' ? 'Finding your location…' : 'Use my location'}</button>{!settings && <button type="button" className="text-button" onClick={control.disable}>Not now</button>}</>}</div>
    </div>{!settings && <button type="button" className="icon-button location-dismiss" aria-label="Dismiss location prompt" onClick={control.disable}><X size={16} /></button>}
  </section>;
}
