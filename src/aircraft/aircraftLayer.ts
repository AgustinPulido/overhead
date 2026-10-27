import {
  ArcType,
  BillboardCollection,
  Cartesian3,
  Color,
  Material,
  Math as CesiumMath,
  NearFarScalar,
  PolylineCollection,
  type Billboard,
  type Polyline,
  type Viewer,
} from 'cesium';
import type { PickId } from '../globe/picking';
import type { InfoData, SearchResult } from '../ui/types';
import { fetchStates, RateLimitError, type AircraftState } from './opensky';

const POLL_MS = 15_000;
const EXTRAPOLATE_MS = 1000;
/** No extrapolamos más allá de esto: si un avión deja de reportar, se queda quieto. */
const MAX_EXTRAPOLATION_S = 60;
const FETCH_TIMEOUT_MS = 20_000;
export const TRAIL_LENGTH = 40;

const EARTH_RADIUS_M = 6_371_000;
const SCALE_BY_DISTANCE = new NearFarScalar(2e5, 1.2, 2e7, 0.35);
const ICON = createPlaneIcon();

interface Track {
  state: AircraftState;
  billboard: Billboard;
  /** Últimas posiciones reportadas (no extrapoladas), la más vieja primero. */
  trail: Cartesian3[];
}

export type AircraftStatus =
  | { kind: 'ok'; count: number; time: number }
  | { kind: 'rate-limited'; retryAfterSec: number }
  | { kind: 'error'; message: string };

export class AircraftLayer {
  private readonly billboards: BillboardCollection;
  private readonly trails: PolylineCollection;
  private readonly tracks = new Map<string, Track>();
  private trailLine: Polyline | null = null;
  private selected: string | null = null;
  private pollTimer: number | undefined;
  private extrapolateTimer: number | undefined;
  private stopped = false;

  onUpdate: () => void = () => {};
  onStatus: (status: AircraftStatus) => void = () => {};

  constructor(private readonly viewer: Viewer) {
    this.billboards = viewer.scene.primitives.add(new BillboardCollection());
    this.trails = viewer.scene.primitives.add(new PolylineCollection());
  }

  start() {
    this.stopped = false;
    void this.poll();
    this.extrapolateTimer = window.setInterval(() => this.extrapolate(), EXTRAPOLATE_MS);
  }

  private async poll() {
    // Con la pestaña oculta o la capa apagada no gastamos créditos de OpenSky.
    if (document.hidden || !this.visible) {
      if (!this.stopped) this.pollTimer = window.setTimeout(() => void this.poll(), 1000);
      return;
    }
    let nextDelay = POLL_MS;
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const { time, states } = await fetchStates(ctrl.signal);
      this.applyStates(states);
      this.onStatus({ kind: 'ok', count: this.tracks.size, time });
    } catch (err) {
      if (err instanceof RateLimitError) {
        nextDelay = err.retryAfterSec * 1000;
        this.onStatus({ kind: 'rate-limited', retryAfterSec: err.retryAfterSec });
      } else {
        const message =
          err instanceof DOMException && err.name === 'AbortError'
            ? 'OpenSky no respondió a tiempo'
            : err instanceof Error
              ? err.message
              : String(err);
        this.onStatus({ kind: 'error', message });
      }
    } finally {
      window.clearTimeout(timeout);
    }
    if (!this.stopped) this.pollTimer = window.setTimeout(() => void this.poll(), nextDelay);
  }

  private applyStates(states: AircraftState[]) {
    const seen = new Set<string>();
    for (const s of states) {
      if (s.onGround) continue;
      seen.add(s.icao24);
      const reported = Cartesian3.fromDegrees(s.longitude, s.latitude, s.altitude);
      let track = this.tracks.get(s.icao24);
      if (!track) {
        const id: PickId = { kind: 'aircraft', icao24: s.icao24 };
        track = {
          state: s,
          trail: [],
          billboard: this.billboards.add({
            id,
            image: ICON,
            position: reported,
            width: 16,
            height: 16,
            alignedAxis: Cartesian3.UNIT_Z,
            scaleByDistance: SCALE_BY_DISTANCE,
          }),
        };
        this.tracks.set(s.icao24, track);
      }
      const last = track.trail[track.trail.length - 1];
      // Solo agregamos al rastro si de verdad hay un reporte nuevo.
      if (!last || s.timePosition !== track.state.timePosition) {
        track.trail.push(reported);
        if (track.trail.length > TRAIL_LENGTH) track.trail.shift();
      }
      track.state = s;
      if (s.icao24 !== this.selected) track.billboard.color = altitudeColor(s.altitude);
      track.billboard.rotation = -CesiumMath.toRadians(s.trueTrack ?? 0);
    }

    // Los que ya no aparecen (aterrizaron o salieron de cobertura) se borran.
    for (const [icao, track] of this.tracks) {
      if (seen.has(icao)) continue;
      this.billboards.remove(track.billboard);
      this.tracks.delete(icao);
      if (icao === this.selected) this.select(null);
    }
    this.extrapolate();
  }

  /** Mueve cada avión según su velocidad y rumbo desde su último reporte. */
  private extrapolate() {
    const nowSec = Date.now() / 1000;
    for (const track of this.tracks.values()) {
      track.billboard.position = this.currentPosition(track.state, nowSec);
    }
    if (this.selected) this.updateTrail();
    this.onUpdate();
  }

  private currentPosition(s: AircraftState, nowSec: number): Cartesian3 {
    const dt = Math.min(Math.max(nowSec - s.timePosition, 0), MAX_EXTRAPOLATION_S);
    if (!s.velocity || s.trueTrack === null || dt === 0) {
      return Cartesian3.fromDegrees(s.longitude, s.latitude, s.altitude);
    }
    // Navegación por estima sobre una esfera (suficiente para segundos).
    const d = (s.velocity * dt) / EARTH_RADIUS_M;
    const brg = CesiumMath.toRadians(s.trueTrack);
    const lat1 = CesiumMath.toRadians(s.latitude);
    const lon1 = CesiumMath.toRadians(s.longitude);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 =
      lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    const alt = s.altitude + (s.verticalRate ?? 0) * dt;
    return Cartesian3.fromRadians(lon2, lat2, Math.max(alt, 0));
  }

  setVisible(visible: boolean) {
    this.billboards.show = visible;
    this.trails.show = visible;
  }

  get visible(): boolean {
    return this.billboards.show;
  }

  get count(): number {
    return this.tracks.size;
  }

  select(icao24: string | null) {
    const prev = this.selected ? this.tracks.get(this.selected) : undefined;
    if (prev) {
      prev.billboard.scale = 1;
      prev.billboard.color = altitudeColor(prev.state.altitude);
    }
    this.selected = icao24;
    const track = icao24 ? this.tracks.get(icao24) : undefined;
    if (!track) {
      this.selected = null;
      this.clearTrail();
      return;
    }
    track.billboard.scale = 1.8;
    track.billboard.color = Color.WHITE;
    this.updateTrail();
  }

  private clearTrail() {
    if (this.trailLine) {
      this.trails.remove(this.trailLine);
      this.trailLine = null;
    }
  }

  private updateTrail() {
    const track = this.selected ? this.tracks.get(this.selected) : undefined;
    if (!track) return this.clearTrail();
    const positions = [...track.trail, track.billboard.position];
    if (positions.length < 2) return this.clearTrail();
    if (this.trailLine) {
      this.trailLine.positions = positions;
      return;
    }
    this.trailLine = this.trails.add({
      positions,
      width: 3,
      arcType: ArcType.NONE,
      material: Material.fromType('PolylineGlow', {
        color: Color.fromCssColorString('#7CFFB2'),
        glowPower: 0.25,
      }),
    });
  }

  positionOf(icao24: string): Cartesian3 | null {
    const t = this.tracks.get(icao24);
    return t ? Cartesian3.clone(t.billboard.position) : null;
  }

  describe(icao24: string): InfoData | null {
    const track = this.tracks.get(icao24);
    if (!track) return null;
    const s = track.state;
    const age = Math.max(0, Math.round(Date.now() / 1000 - s.timePosition));
    return {
      kind: 'aircraft',
      title: s.callsign || s.icao24.toUpperCase(),
      subtitle: `Avión · ${s.originCountry}`,
      color: altitudeColor(s.altitude).toCssColorString(),
      rows: [
        ['ICAO24', s.icao24],
        ['País de registro', s.originCountry],
        ['Altitud', `${fmt(s.altitude, 0)} m (${fmt(s.altitude * 3.28084, 0)} ft)`],
        ['Velocidad', s.velocity !== null ? `${fmt(s.velocity * 3.6, 0)} km/h (${fmt(s.velocity * 1.94384, 0)} kt)` : '—'],
        ['Rumbo', s.trueTrack !== null ? `${fmt(s.trueTrack, 0)}°` : '—'],
        ['Vel. vertical', s.verticalRate !== null ? `${fmt(s.verticalRate, 1)} m/s` : '—'],
        ['Squawk', s.squawk ?? '—'],
        ['Último reporte', `hace ${age} s`],
        ['Puntos de rastro', String(track.trail.length)],
      ],
      link: `https://opensky-network.org/aircraft-profile?icao24=${s.icao24}`,
    };
  }

  search(query: string, limit: number): SearchResult[] {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const out: SearchResult[] = [];
    for (const { state: s } of this.tracks.values()) {
      if (out.length >= limit) break;
      if (s.callsign.toUpperCase().includes(q) || s.icao24.toUpperCase() === q) {
        out.push({
          id: { kind: 'aircraft', icao24: s.icao24 },
          label: s.callsign || s.icao24.toUpperCase(),
          detail: s.originCountry,
        });
      }
    }
    return out;
  }

  destroy() {
    this.stopped = true;
    window.clearTimeout(this.pollTimer);
    window.clearInterval(this.extrapolateTimer);
    this.viewer.scene.primitives.remove(this.billboards);
    this.viewer.scene.primitives.remove(this.trails);
  }
}

function fmt(n: number, digits: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Verde a baja altura → ámbar → rojo arriba de ~12 km. */
function altitudeColor(altitude: number): Color {
  const t = CesiumMath.clamp(altitude / 12_000, 0, 1);
  return Color.fromHsl((120 - 110 * t) / 360, 0.9, 0.6, 1);
}

/** Silueta de avión apuntando hacia arriba (norte), blanca para poder teñirla. */
function createPlaneIcon(): string {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return '';
  g.translate(size / 2, size / 2);
  g.beginPath();
  // fuselaje + alas + cola
  g.moveTo(0, -28);
  g.lineTo(4, -20);
  g.lineTo(4, -6);
  g.lineTo(28, 6);
  g.lineTo(28, 11);
  g.lineTo(4, 4);
  g.lineTo(4, 18);
  g.lineTo(11, 24);
  g.lineTo(11, 28);
  g.lineTo(0, 25);
  g.lineTo(-11, 28);
  g.lineTo(-11, 24);
  g.lineTo(-4, 18);
  g.lineTo(-4, 4);
  g.lineTo(-28, 11);
  g.lineTo(-28, 6);
  g.lineTo(-4, -6);
  g.lineTo(-4, -20);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 3;
  g.stroke();
  g.fill();
  return c.toDataURL();
}
