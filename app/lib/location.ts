import { z } from 'zod';

export const locationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  capturedAt: z.string().datetime(),
}).strict();
export type SharedLocation = z.infer<typeof locationSchema>;
export const locationLifetime = 15 * 60 * 1000;
export function approximateLocation(position: Pick<GeolocationPosition, 'coords'>): SharedLocation {
  return locationSchema.parse({ latitude: Math.round(position.coords.latitude * 100) / 100, longitude: Math.round(position.coords.longitude * 100) / 100, capturedAt: new Date().toISOString() });
}
export function currentLocation(location: SharedLocation | null, now = Date.now()): SharedLocation | undefined {
  if (!location) return undefined;
  const age = now - Date.parse(location.capturedAt);
  return age >= 0 && age < locationLifetime ? location : undefined;
}
