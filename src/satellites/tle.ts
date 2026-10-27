export interface TleRecord {
  name: string;
  line1: string;
  line2: string;
}

export interface TleResult {
  records: TleRecord[];
  /** Momento en que se descargaron los datos (ms epoch). */
  fetchedAt: number;
  source: 'network' | 'cache' | 'stale-cache';
}

/**
 * Grupo de CelesTrak a descargar. Por defecto 'active'; se puede cambiar con
 * ?group=starlink, ?group=stations, etc. en la URL de la app.
 */
const GROUP = (new URLSearchParams(location.search).get('group') ?? '').replace(/[^a-z0-9-]/gi, '') || 'active';
const TLE_URL = `/api/celestrak/NORAD/elements/gp.php?GROUP=${GROUP}&FORMAT=tle`;
const CACHE_KEY = `overhead:tle:${GROUP}`;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  text: string;
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    return typeof entry.text === 'string' && typeof entry.fetchedAt === 'number' ? entry : null;
  } catch {
    return null;
  }
}

function writeCache(text: string): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), text }));
  } catch (err) {
    // Cuota llena o storage bloqueado: seguimos sin caché.
    console.warn('No se pudo guardar el TLE en localStorage', err);
  }
}

export function parseTle(text: string): TleRecord[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length > 0);
  const records: TleRecord[] = [];
  for (let i = 0; i + 2 < lines.length; ) {
    const name = lines[i];
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (l1?.startsWith('1 ') && l2?.startsWith('2 ')) {
      records.push({ name: name.trim(), line1: l1, line2: l2 });
      i += 3;
    } else {
      i += 1; // línea suelta o corrupta: resincronizar
    }
  }
  return records;
}

/**
 * Devuelve los TLE de satélites activos. Usa la caché si tiene menos de 2 h;
 * si la red falla, cae a la caché vencida antes de rendirse.
 */
export async function loadTles(): Promise<TleResult> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    const records = parseTle(cached.text);
    if (records.length > 0) return { records, fetchedAt: cached.fetchedAt, source: 'cache' };
  }

  try {
    const res = await fetch(TLE_URL);
    if (!res.ok) throw new Error(`CelesTrak respondió HTTP ${res.status}`);
    const text = await res.text();
    const records = parseTle(text);
    // CelesTrak a veces responde 200 con un mensaje de texto (p. ej. límite de descargas).
    if (records.length === 0) throw new Error(`Respuesta inesperada de CelesTrak: ${text.slice(0, 120)}`);
    writeCache(text);
    return { records, fetchedAt: Date.now(), source: 'network' };
  } catch (err) {
    if (cached) {
      const records = parseTle(cached.text);
      if (records.length > 0) {
        console.warn('Usando TLE vencidos de la caché', err);
        return { records, fetchedAt: cached.fetchedAt, source: 'stale-cache' };
      }
    }
    throw err;
  }
}
