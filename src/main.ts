import { BoundingSphere, HeadingPitchRange, Math as CesiumMath } from 'cesium';
import './style.css';
import { AircraftLayer } from './aircraft/aircraftLayer';
import { setupPicking, type PickId } from './globe/picking';
import { createViewer, setBaseMap } from './globe/viewer';
import { SatelliteLayer } from './satellites/satelliteLayer';
import { Controls } from './ui/controls';
import { InfoPanel } from './ui/infoPanel';
import type { InfoData } from './ui/types';

const SEARCH_LIMIT = 12;

const viewer = createViewer('globe');
const ui = document.getElementById('ui')!;

const satellites = new SatelliteLayer(viewer);
const aircraft = new AircraftLayer(viewer);

let selection: PickId | null = null;

function describe(id: PickId): InfoData | null {
  return id.kind === 'satellite' ? satellites.describe(id.index) : aircraft.describe(id.icao24);
}

function select(id: PickId | null) {
  satellites.select(id?.kind === 'satellite' ? id.index : null);
  aircraft.select(id?.kind === 'aircraft' ? id.icao24 : null);
  selection = id;
  const data = id ? describe(id) : null;
  if (data) info.show(data);
  else {
    selection = null;
    info.hide();
  }
}

function flyTo(id: PickId) {
  const pos = id.kind === 'satellite' ? satellites.positionOf(id.index) : aircraft.positionOf(id.icao24);
  if (!pos) return;
  const range = id.kind === 'satellite' ? 3_000_000 : 400_000;
  viewer.camera.flyToBoundingSphere(new BoundingSphere(pos, 1), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-60), range),
    duration: 1.6,
  });
}

function refresh() {
  controls.setCounts(satellites.count, aircraft.count, satellites.visible, aircraft.visible);
  if (selection) {
    const data = describe(selection);
    // El objeto pudo haber desaparecido (p. ej. un avión que aterrizó).
    if (data) info.show(data);
    else select(null);
  }
}

const controls = new Controls(ui, {
  onToggleSatellites: (v) => {
    satellites.setVisible(v);
    if (!v && selection?.kind === 'satellite') select(null);
    refresh();
  },
  onToggleAircraft: (v) => {
    aircraft.setVisible(v);
    if (!v && selection?.kind === 'aircraft') select(null);
    refresh();
  },
  onBaseMap: (map) => setBaseMap(viewer, map),
  onSearch: (q) => {
    const half = Math.ceil(SEARCH_LIMIT / 2);
    const sats = satellites.visible ? satellites.search(q, SEARCH_LIMIT) : [];
    const planes = aircraft.visible ? aircraft.search(q, SEARCH_LIMIT) : [];
    // Repartir los lugares entre ambos tipos cuando hay muchos resultados.
    const nPlanes = Math.min(planes.length, Math.max(half, SEARCH_LIMIT - sats.length));
    return [...planes.slice(0, nPlanes), ...sats.slice(0, SEARCH_LIMIT - nPlanes)];
  },
  onPickResult: (id) => {
    select(id);
    flyTo(id);
  },
});

const info = new InfoPanel(
  ui,
  () => select(null),
  () => selection && flyTo(selection),
);

setupPicking(viewer, (id) => {
  if (id?.kind === 'satellite' && !satellites.visible) return;
  if (id?.kind === 'aircraft' && !aircraft.visible) return;
  select(id);
});

// --- Satélites ---
satellites.onUpdate = refresh;
satellites.onError = (msg) => controls.setSatelliteStatus(msg, 'error');
satellites
  .load()
  .then((r) => {
    const when = new Date(r.fetchedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const n = r.records.length.toLocaleString('es-AR');
    if (r.source === 'stale-cache') {
      controls.setSatelliteStatus(`CelesTrak no responde; usando caché vieja (${when}) · ${n} TLE`, 'warn');
    } else {
      const src = r.source === 'cache' ? 'caché' : 'CelesTrak';
      controls.setSatelliteStatus(`${n} TLE de ${src} · ${when}`);
    }
  })
  .catch((err: unknown) => {
    console.error(err);
    controls.setSatelliteStatus(
      `No se pudieron cargar los satélites: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  });

// --- Aviones ---
aircraft.onUpdate = refresh;
aircraft.onStatus = (s) => {
  if (s.kind === 'ok') {
    const when = new Date(s.time * 1000).toLocaleTimeString('es-AR');
    controls.setAircraftStatus(`En vuelo · actualizado ${when}`);
  } else if (s.kind === 'rate-limited') {
    const mins = Math.ceil(s.retryAfterSec / 60);
    controls.setAircraftStatus(`Límite diario de OpenSky alcanzado. Reintento en ~${mins} min.`, 'warn');
  } else {
    controls.setAircraftStatus(`${s.message}. Reintentando…`, 'error');
  }
};
aircraft.start();
