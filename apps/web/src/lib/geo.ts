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

function requestPosition(options: PositionOptions): Promise<GeoPosition> {
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
      options,
    );
  });
}

/**
 * Ask for a location right before submitting. Laptops and desktops often only
 * have Wi-Fi/IP-based positioning, so a precise fix is preferred but any
 * successful fix is accepted. A denial is still surfaced to the user.
 */
export async function getCurrentPosition(): Promise<GeoPosition> {
  try {
    return await requestPosition({
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 0,
    });
  } catch (error) {
    if (error instanceof GeoError && error.code === 'denied') {
      throw error;
    }
    return requestPosition({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 60_000,
    });
  }
}
