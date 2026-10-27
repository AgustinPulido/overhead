import { escapeHtml } from './controls';
import type { InfoData } from './types';

export class InfoPanel {
  private readonly el: HTMLElement;
  private shownKey: string | null = null;

  constructor(container: HTMLElement, private readonly onClose: () => void, private readonly onFollow: () => void) {
    container.insertAdjacentHTML('beforeend', '<aside class="panel info" hidden></aside>');
    this.el = container.querySelector('.info')!;
    this.el.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'close') this.onClose();
      if (action === 'focus') this.onFollow();
    });
  }

  /**
   * Se llama ~2 veces por segundo; si es el mismo objeto solo reescribimos los
   * datos, para no recrear los botones mientras el usuario los está clickeando.
   */
  show(data: InfoData) {
    const key = `${data.kind}:${data.title}`;
    const rows = data.rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');
    this.el.style.setProperty('--accent', data.color ?? '#7cc4ff');
    if (key === this.shownKey) {
      this.el.querySelector('dl')!.innerHTML = rows;
      return;
    }
    this.shownKey = key;
    this.el.hidden = false;
    this.el.innerHTML = `
      <header>
        <div>
          <p class="subtitle">${escapeHtml(data.subtitle)}</p>
          <h2>${escapeHtml(data.title)}</h2>
        </div>
        <button class="icon-btn" data-action="close" aria-label="Cerrar">×</button>
      </header>
      <dl>${rows}</dl>
      <footer>
        <button class="btn" data-action="focus">Centrar</button>
        ${data.link ? `<a class="btn ghost" href="${data.link}" target="_blank" rel="noopener">Más info ↗</a>` : ''}
      </footer>`;
  }

  hide() {
    this.shownKey = null;
    this.el.hidden = true;
    this.el.innerHTML = '';
  }
}
