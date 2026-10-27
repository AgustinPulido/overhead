/// <reference lib="webworker" />
import {
  eciToEcf,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
  type EciVec3,
  type SatRec,
} from 'satellite.js';
import { OrbitClass, type FromWorker, type ToWorker } from './protocol';

const EARTH_RADIUS_KM = 6378.135;
const PROPAGATE_OPTS = { communityDecayCheckEnabled: true };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let satrecs: (SatRec | null)[] = [];

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

function classify(rec: SatRec): OrbitClass {
  // satrec.a es el semieje mayor en radios terrestres.
  const meanAltKm = (rec.a - 1) * EARTH_RADIUS_KM;
  if (!Number.isFinite(meanAltKm)) return OrbitClass.Invalid;
  if (meanAltKm < 2000) return OrbitClass.LEO;
  if (meanAltKm < 34000) return OrbitClass.MEO;
  return OrbitClass.GEO;
}

function init(tles: { name: string; line1: string; line2: string }[]) {
  satrecs = tles.map((t) => {
    try {
      const rec = twoline2satrec(t.line1, t.line2);
      return rec.error ? null : rec;
    } catch {
      return null;
    }
  });
  const orbitClass = new Uint8Array(satrecs.length);
  const periods = new Float32Array(satrecs.length);
  satrecs.forEach((rec, i) => {
    orbitClass[i] = rec ? classify(rec) : OrbitClass.Invalid;
    periods[i] = rec ? (2 * Math.PI) / rec.no : NaN; // rec.no en rad/min
  });
  post({ type: 'ready', count: satrecs.length, orbitClass, periods }, [
    orbitClass.buffer,
    periods.buffer,
  ]);
}

function tick(time: number) {
  const date = new Date(time);
  const gmst = gstime(date);
  const n = satrecs.length;
  const positions = new Float64Array(n * 3).fill(NaN);
  const heights = new Float32Array(n).fill(NaN);
  const speeds = new Float32Array(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    const rec = satrecs[i];
    if (!rec) continue;
    const pv = propagate(rec, date, PROPAGATE_OPTS);
    if (!pv) continue;
    const { position: p, velocity: v } = pv;
    if (!Number.isFinite(p.x)) continue;
    const ecf = eciToEcf(p, gmst);
    positions[i * 3] = ecf.x * 1000;
    positions[i * 3 + 1] = ecf.y * 1000;
    positions[i * 3 + 2] = ecf.z * 1000;
    heights[i] = eciToGeodetic(p, gmst).height;
    speeds[i] = Math.hypot(v.x, v.y, v.z);
  }

  post({ type: 'positions', time, positions, heights, speeds }, [
    positions.buffer,
    heights.buffer,
    speeds.buffer,
  ]);
}

/**
 * Un período completo de la órbita, en marco inercial "congelado" con la
 * rotación terrestre del instante actual: así se dibuja como una elipse
 * cerrada que pasa por la posición actual del satélite.
 */
function orbit(index: number, time: number, samples: number) {
  const rec = satrecs[index];
  if (!rec) {
    post({ type: 'orbit', index, positions: new Float64Array(0) });
    return;
  }
  const periodMs = ((2 * Math.PI) / rec.no) * 60_000;
  const gmstNow = gstime(new Date(time));
  const out: number[] = [];
  for (let k = 0; k <= samples; k++) {
    const pv = propagate(rec, new Date(time + (k / samples) * periodMs), PROPAGATE_OPTS);
    if (!pv || !Number.isFinite(pv.position.x)) continue;
    const ecf = eciToEcf(pv.position as EciVec3<number>, gmstNow);
    out.push(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000);
  }
  const positions = Float64Array.from(out);
  post({ type: 'orbit', index, positions }, [positions.buffer]);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  try {
    const msg = e.data;
    if (msg.type === 'init') init(msg.tles);
    else if (msg.type === 'tick') tick(msg.time);
    else if (msg.type === 'orbit') orbit(msg.index, msg.time, msg.samples);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
