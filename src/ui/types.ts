import type { PickId } from '../globe/picking';

export interface InfoData {
  kind: PickId['kind'];
  title: string;
  subtitle: string;
  /** Color de acento (CSS) para el panel. */
  color?: string;
  rows: [label: string, value: string][];
  link?: string;
}

export interface SearchResult {
  id: PickId;
  label: string;
  detail?: string;
}
