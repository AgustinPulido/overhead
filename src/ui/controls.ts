import { BASE_MAPS, DEFAULT_BASE_MAP, type BaseMap } from '../globe/viewer';
import type { PickId } from '../globe/picking';
import type { SearchResult } from './types';

export interface ControlsOptions {
  onToggleSatellites: (visible: boolean) => void;
  onToggleAircraft: (visible: boolean) => void;
  onBaseMap: (map: BaseMap) => void;
  onSearch: (query: string) => SearchResult[];
  onPickResult: (id: PickId) => void;
}

export type StatusLevel = 'info' | 'warn' | 'error';

export class Controls {
  private readonly root: HTMLElement;
  private readonly satCount: HTMLElement;
  private readonly airCount: HTMLElement;
  private readonly totalCount: HTMLElement;
  private readonly satStatus: HTMLElement;
  private readonly airStatus: HTMLElement;
  private readonly results: HTMLUListElement;
  private readonly input: HTMLInputElement;
  private current: SearchResult[] = [];
  private active = -1;

  constructor(container: HTMLElement, private readonly opts: ControlsOptions) {
    container.insertAdjacentHTML(
      'beforeend',
      `
      <section class="panel controls">
        <header class="brand">
          <span class="brand-dot"></span>
          <h1>Overhead</h1>
        </header>

        <div class="search">
          <input type="search" placeholder="Buscar satélite, NORAD, callsign…" autocomplete="off" spellcheck="false" aria-label="Buscar" />
          <ul class="results" role="listbox" hidden></ul>
        </div>

        <label class="toggle">
          <input type="checkbox" data-layer="satellites" checked />
          <span class="toggle-label">Satélites</span>
          <span class="count" data-count="satellites">0</span>
        </label>
        <div class="legend">
          <span><i style="background:#4fd1ff"></i>LEO</span>
          <span><i style="background:#ffd166"></i>MEO</span>
          <span><i style="background:#ff6bd6"></i>GEO</span>
        </div>
        <p class="status" data-status="satellites">Cargando TLE…</p>

        <label class="toggle">
          <input type="checkbox" data-layer="aircraft" checked />
          <span class="toggle-label">Aviones</span>
          <span class="count" data-count="aircraft">0</span>
        </label>
        <div class="legend gradient"><span>0 km</span><i></i><span>12+ km</span></div>
        <p class="status" data-status="aircraft">Consultando OpenSky…</p>

        <div class="footer-row">
          <span>Visibles: <strong data-count="total">0</strong></span>
          <select aria-label="Mapa base" data-basemap>
            ${BASE_MAPS.map(
              (m) => `<option value="${m.id}"${m.id === DEFAULT_BASE_MAP ? ' selected' : ''}>${m.label}</option>`,
            ).join('')}
          </select>
        </div>
      </section>`,
    );
    this.root = container.querySelector('.controls')!;
    const q = <T extends Element>(sel: string) => this.root.querySelector<T>(sel)!;
    this.satCount = q('[data-count="satellites"]');
    this.airCount = q('[data-count="aircraft"]');
    this.totalCount = q('[data-count="total"]');
    this.satStatus = q('[data-status="satellites"]');
    this.airStatus = q('[data-status="aircraft"]');
    this.results = q('.results');
    this.input = q('.search input');

    q<HTMLInputElement>('[data-layer="satellites"]').addEventListener('change', (e) =>
      opts.onToggleSatellites((e.target as HTMLInputElement).checked),
    );
    q<HTMLInputElement>('[data-layer="aircraft"]').addEventListener('change', (e) =>
      opts.onToggleAircraft((e.target as HTMLInputElement).checked),
    );
    q<HTMLSelectElement>('[data-basemap]').addEventListener('change', (e) =>
      opts.onBaseMap((e.target as HTMLSelectElement).value as BaseMap),
    );
    this.setupSearch();
  }

  private setupSearch() {
    this.input.addEventListener('input', () => this.runSearch());
    this.input.addEventListener('focus', () => this.runSearch());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.current.length === 0) return;
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        this.active = (this.active + delta + this.current.length) % this.current.length;
        this.renderResults();
      } else if (e.key === 'Enter') {
        const r = this.current[Math.max(this.active, 0)];
        if (r) this.choose(r);
      } else if (e.key === 'Escape') {
        this.hideResults();
        this.input.blur();
      }
    });
    // mousedown en vez de click para ganarle al blur del input.
    this.results.addEventListener('mousedown', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (!li) return;
      e.preventDefault();
      const r = this.current[Number(li.dataset.i)];
      if (r) this.choose(r);
    });
    this.input.addEventListener('blur', () => this.hideResults());
  }

  private runSearch() {
    this.current = this.opts.onSearch(this.input.value);
    this.active = this.current.length ? 0 : -1;
    this.renderResults();
  }

  private renderResults() {
    if (!this.input.value.trim()) return this.hideResults();
    this.results.hidden = false;
    if (this.current.length === 0) {
      this.results.innerHTML = '<li class="empty">Sin resultados</li>';
      return;
    }
    this.results.innerHTML = this.current
      .map(
        (r, i) => `
        <li data-i="${i}" role="option" class="${i === this.active ? 'active' : ''}">
          <span class="kind kind-${r.id.kind}">${r.id.kind === 'satellite' ? 'SAT' : 'AVI'}</span>
          <span class="label">${escapeHtml(r.label)}</span>
          ${r.detail ? `<span class="detail">${escapeHtml(r.detail)}</span>` : ''}
        </li>`,
      )
      .join('');
  }

  private hideResults() {
    this.results.hidden = true;
  }

  private choose(r: SearchResult) {
    this.input.value = r.label;
    this.hideResults();
    this.input.blur();
    this.opts.onPickResult(r.id);
  }

  setCounts(satellites: number, aircraft: number, satVisible: boolean, airVisible: boolean) {
    this.satCount.textContent = satellites.toLocaleString('es-AR');
    this.airCount.textContent = aircraft.toLocaleString('es-AR');
    const total = (satVisible ? satellites : 0) + (airVisible ? aircraft : 0);
    this.totalCount.textContent = total.toLocaleString('es-AR');
  }

  setSatelliteStatus(text: string, level: StatusLevel = 'info') {
    setStatus(this.satStatus, text, level);
  }

  setAircraftStatus(text: string, level: StatusLevel = 'info') {
    setStatus(this.airStatus, text, level);
  }
}

function setStatus(el: HTMLElement, text: string, level: StatusLevel) {
  el.textContent = text;
  el.dataset.level = level;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
