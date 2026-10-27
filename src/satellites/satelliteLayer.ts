import {
  ArcType,
  Cartesian3,
  Color,
  Material,
  NearFarScalar,
  PointPrimitiveCollection,
  PolylineCollection,
  type PointPrimitive,
  type Polyline,
  type Viewer,
} from 'cesium';
import type { PickId } from '../globe/picking';
import type { InfoData, SearchResult } from '../ui/types';
import { ORBIT_CLASS_LABEL, OrbitClass, type FromWorker, type ToWorker } from './protocol';
import { loadTles, type TleRecord, type TleResult } from './tle';

const TICK_MS = 1000;
const ORBIT_SAMPLES = 360;

export const ORBIT_COLORS: Record<number, Color> = {
  [OrbitClass.LEO]: Color.fromCssColorString('#4fd1ff'),
  [OrbitClass.MEO]: Color.fromCssColorString('#ffd166'),
  [OrbitClass.GEO]: Color.fromCssColorString('#ff6bd6'),
  [OrbitClass.Invalid]: Color.GRAY,
};

const BASE_SIZE = 3;
const SELECTED_SIZE = 9;
// Los puntos se achican un poco al alejar la cámara para no saturar la vista.
const SCALE_BY_DISTANCE = new NearFarScalar(1e6, 1.4, 1e8, 0.6);
const scratch = new Cartesian3();

export class SatelliteLayer {
  private readonly points: PointPrimitiveCollection;
  private readonly orbitLines: PolylineCollection;
  private orbitLine: Polyline | null = null;
  private worker: Worker | null = null;
  private tickTimer: number | undefined;
  private workerBusy = false;

  private tles: TleRecord[] = [];
  private prims: PointPrimitive[] = [];
  private orbitClass: Uint8Array = new Uint8Array(0);
  private periods: Float32Array = new Float32Array(0);
  private heights: Float32Array = new Float32Array(0);
  private speeds: Float32Array = new Float32Array(0);
  private validCount = 0;
  private selected: number | null = null;

  /** Se llama después de cada actualización de posiciones. */
  onUpdate: () => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(private readonly viewer: Viewer) {
    this.points = viewer.scene.primitives.add(new PointPrimitiveCollection());
    this.orbitLines = viewer.scene.primitives.add(new PolylineCollection());
  }

  async load(): Promise<TleResult> {
    const result = await loadTles();
    this.tles = result.records;
    this.startWorker();
    return result;
  }

  private startWorker() {
    this.worker = new Worker(new URL('./propagator.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handleMessage(e.data);
    this.worker.onerror = (e) => {
      this.workerBusy = false;
      this.onError(`Error en el worker de satélites: ${e.message}`);
    };
    this.send({ type: 'init', tles: this.tles });
  }

  private send(msg: ToWorker) {
    this.worker?.postMessage(msg);
  }

  private handleMessage(msg: FromWorker) {
    switch (msg.type) {
      case 'ready':
        this.orbitClass = msg.orbitClass;
        this.periods = msg.periods;
        this.createPoints();
        this.tick();
        this.tickTimer = window.setInterval(() => this.tick(), TICK_MS);
        break;
      case 'positions':
        this.workerBusy = false;
        this.applyPositions(msg.positions, msg.heights, msg.speeds);
        break;
      case 'orbit':
        if (msg.index === this.selected) this.drawOrbit(msg.positions);
        break;
      case 'error':
        this.workerBusy = false;
        this.onError(msg.message);
        break;
    }
  }

  private createPoints() {
    this.points.removeAll();
    this.prims = this.tles.map((_, i) => {
      const id: PickId = { kind: 'satellite', index: i };
      return this.points.add({
        id,
        show: false, // hasta tener la primera posición válida
        pixelSize: BASE_SIZE,
        color: ORBIT_COLORS[this.orbitClass[i]],
        scaleByDistance: SCALE_BY_DISTANCE,
      });
    });
  }

  private tick() {
    // Si el worker todavía no terminó el cálculo anterior, salteamos este tick.
    if (this.workerBusy) return;
    this.workerBusy = true;
    this.send({ type: 'tick', time: Date.now() });
  }

  private applyPositions(positions: Float64Array, heights: Float32Array, speeds: Float32Array) {
    this.heights = heights;
    this.speeds = speeds;
    let valid = 0;
    for (let i = 0; i < this.prims.length; i++) {
      const x = positions[i * 3];
      const p = this.prims[i];
      if (Number.isNaN(x)) {
        p.show = false;
        continue;
      }
      p.position = Cartesian3.fromElements(x, positions[i * 3 + 1], positions[i * 3 + 2], scratch);
      p.show = true;
      valid++;
    }
    this.validCount = valid;
    this.onUpdate();
  }

  setVisible(visible: boolean) {
    this.points.show = visible;
    this.orbitLines.show = visible;
  }

  get visible(): boolean {
    return this.points.show;
  }

  /** Satélites con posición válida (dibujados si la capa está visible). */
  get count(): number {
    return this.validCount;
  }

  get total(): number {
    return this.tles.length;
  }

  select(index: number | null) {
    if (this.selected !== null && this.prims[this.selected]) {
      const prev = this.prims[this.selected];
      prev.pixelSize = BASE_SIZE;
      prev.outlineWidth = 0;
    }
    this.clearOrbit();
    this.selected = index;
    if (index === null || !this.prims[index]) return;

    const p = this.prims[index];
    p.pixelSize = SELECTED_SIZE;
    p.outlineColor = Color.WHITE;
    p.outlineWidth = 2;
    this.send({ type: 'orbit', index, time: Date.now(), samples: ORBIT_SAMPLES });
  }

  private clearOrbit() {
    if (this.orbitLine) {
      this.orbitLines.remove(this.orbitLine);
      this.orbitLine = null;
    }
  }

  private drawOrbit(flat: Float64Array) {
    this.clearOrbit();
    if (flat.length < 6 || this.selected === null) return;
    const positions: Cartesian3[] = [];
    for (let i = 0; i < flat.length; i += 3) {
      positions.push(new Cartesian3(flat[i], flat[i + 1], flat[i + 2]));
    }
    const color = ORBIT_COLORS[this.orbitClass[this.selected]];
    this.orbitLine = this.orbitLines.add({
      positions,
      width: 1.5,
      arcType: ArcType.NONE,
      material: Material.fromType('Color', { color: color.withAlpha(0.8) }),
    });
  }

  positionOf(index: number): Cartesian3 | null {
    const p = this.prims[index];
    return p && p.show ? Cartesian3.clone(p.position) : null;
  }

  describe(index: number): InfoData | null {
    const tle = this.tles[index];
    if (!tle) return null;
    const norad = tle.line1.substring(2, 7).trim();
    const cospar = tle.line1.substring(9, 17).trim();
    const height = this.heights[index];
    const speed = this.speeds[index];
    const period = this.periods[index];
    const cls = this.orbitClass[index];
    return {
      kind: 'satellite',
      title: tle.name,
      subtitle: `Satélite · ${ORBIT_CLASS_LABEL[cls] ?? '—'}`,
      color: ORBIT_COLORS[cls]?.toCssColorString(),
      rows: [
        ['NORAD ID', norad],
        ['COSPAR', cospar ? formatCospar(cospar) : '—'],
        ['Altitud', Number.isFinite(height) ? `${fmt(height, 0)} km` : '—'],
        ['Velocidad', Number.isFinite(speed) ? `${fmt(speed, 2)} km/s (${fmt(speed * 3600, 0)} km/h)` : '—'],
        ['Período', Number.isFinite(period) ? formatPeriod(period) : '—'],
      ],
      link: `https://celestrak.org/satcat/table-satcat.php?CATNR=${norad}`,
    };
  }

  search(query: string, limit: number): SearchResult[] {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const out: SearchResult[] = [];
    for (let i = 0; i < this.tles.length && out.length < limit; i++) {
      const t = this.tles[i];
      if (t.name.toUpperCase().includes(q) || t.line1.substring(2, 7).trim() === q) {
        out.push({ id: { kind: 'satellite', index: i }, label: t.name, detail: ORBIT_CLASS_LABEL[this.orbitClass[i]] });
      }
    }
    return out;
  }

  destroy() {
    window.clearInterval(this.tickTimer);
    this.worker?.terminate();
    this.viewer.scene.primitives.remove(this.points);
    this.viewer.scene.primitives.remove(this.orbitLines);
  }
}

function fmt(n: number, digits: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPeriod(minutes: number): string {
  if (minutes < 120) return `${fmt(minutes, 1)} min`;
  return `${fmt(minutes / 60, 2)} h`;
}

/** "98067A" → "1998-067A" */
function formatCospar(raw: string): string {
  const yy = Number(raw.substring(0, 2));
  if (Number.isNaN(yy)) return raw;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return `${year}-${raw.substring(2)}`;
}
