export interface AircraftState {
  icao24: string;
  callsign: string;
  originCountry: string;
  /** Segundos epoch de la última posición reportada. */
  timePosition: number;
  longitude: number;
  latitude: number;
  /** Altitud en metros (geométrica si está, si no barométrica). */
  altitude: number;
  onGround: boolean;
  /** m/s */
  velocity: number | null;
  /** Rumbo verdadero en grados desde el norte. */
  trueTrack: number | null;
  /** m/s */
  verticalRate: number | null;
  squawk: string | null;
}

export interface StatesResponse {
  time: number;
  states: AircraftState[];
}

/** Error con el tiempo sugerido de espera, cuando OpenSky nos limita (HTTP 429). */
export class RateLimitError extends Error {
  constructor(public readonly retryAfterSec: number) {
    super(`Límite de OpenSky alcanzado; reintento en ${Math.round(retryAfterSec / 60)} min`);
  }
}

const STATES_URL = '/api/opensky/states/all';

type RawState = [
  string, // 0 icao24
  string | null, // 1 callsign
  string, // 2 origin_country
  number | null, // 3 time_position
  number, // 4 last_contact
  number | null, // 5 longitude
  number | null, // 6 latitude
  number | null, // 7 baro_altitude
  boolean, // 8 on_ground
  number | null, // 9 velocity
  number | null, // 10 true_track
  number | null, // 11 vertical_rate
  number[] | null, // 12 sensors
  number | null, // 13 geo_altitude
  string | null, // 14 squawk
  boolean, // 15 spi
  number, // 16 position_source
];

export async function fetchStates(signal?: AbortSignal): Promise<StatesResponse> {
  const res = await fetch(STATES_URL, { signal });
  if (res.status === 429) {
    const retry = Number(res.headers.get('X-Rate-Limit-Retry-After-Seconds'));
    throw new RateLimitError(Number.isFinite(retry) && retry > 0 ? retry : 300);
  }
  if (!res.ok) throw new Error(`OpenSky respondió HTTP ${res.status}`);

  const data = (await res.json()) as { time: number; states: RawState[] | null };
  const states: AircraftState[] = [];
  for (const s of data.states ?? []) {
    const lon = s[5];
    const lat = s[6];
    if (lon === null || lat === null) continue;
    states.push({
      icao24: s[0],
      callsign: (s[1] ?? '').trim(),
      originCountry: s[2],
      timePosition: s[3] ?? s[4],
      longitude: lon,
      latitude: lat,
      altitude: s[13] ?? s[7] ?? 0,
      onGround: s[8],
      velocity: s[9],
      trueTrack: s[10],
      verticalRate: s[11],
      squawk: s[14],
    });
  }
  return { time: data.time, states };
}
