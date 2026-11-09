export const MAX_ACCURACY_METERS = 100;

export type GeoErrorCode = 'denied' | 'unavailable' | 'timeout';

export class GeoError extends Error {
  constructor(public readonly code: GeoErrorCode) {
    super(`Geolocation failed: ${code}`);
    this.name = 'GeoError';
  }
}

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * Ask for a fresh high-accuracy fix right before submitting. The phone clock
 * and cached positions are deliberately not trusted.
 */
export function getCurrentPosition(): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoError('unavailable'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new GeoError('denied'));
        } else if (error.code === error.TIMEOUT) {
          reject(new GeoError('timeout'));
        } else {
          reject(new GeoError('unavailable'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      },
    );
  });
}
