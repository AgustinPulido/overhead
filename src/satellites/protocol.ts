import type { TleRecord } from './tle';

/** Clase orbital codificada como entero para poder mandarla en un Uint8Array. */
export enum OrbitClass {
  LEO = 0,
  MEO = 1,
  GEO = 2,
  Invalid = 255,
}

export const ORBIT_CLASS_LABEL: Record<number, string> = {
  [OrbitClass.LEO]: 'LEO',
  [OrbitClass.MEO]: 'MEO',
  [OrbitClass.GEO]: 'GEO',
  [OrbitClass.Invalid]: '—',
};

export type ToWorker =
  | { type: 'init'; tles: TleRecord[] }
  | { type: 'tick'; time: number }
  | { type: 'orbit'; index: number; time: number; samples: number };

export type FromWorker =
  | {
      type: 'ready';
      count: number;
      orbitClass: Uint8Array;
      /** Período orbital en minutos. */
      periods: Float32Array;
    }
  | {
      type: 'positions';
      time: number;
      /** ECEF en metros, xyz intercalado. NaN si la propagación falló. */
      positions: Float64Array;
      /** Altitud geodésica en km. */
      heights: Float32Array;
      /** Velocidad inercial en km/s. */
      speeds: Float32Array;
    }
  | { type: 'orbit'; index: number; positions: Float64Array }
  | { type: 'error'; message: string };
