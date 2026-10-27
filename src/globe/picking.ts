import { defined, ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer } from 'cesium';

/** Lo que guardamos en `id` de cada primitiva para saber qué se clickeó. */
export type PickId = { kind: 'satellite'; index: number } | { kind: 'aircraft'; icao24: string };

export function isPickId(value: unknown): value is PickId {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === 'satellite' && typeof v.index === 'number') ||
    (v.kind === 'aircraft' && typeof v.icao24 === 'string')
  );
}

/** Llama a `onPick` con el objeto clickeado, o `null` si se clickeó el vacío. */
export function setupPicking(viewer: Viewer, onPick: (id: PickId | null) => void): void {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
    // drillPick con radio chico tolera clics imprecisos sobre puntos de pocos píxeles.
    const picked = viewer.scene.drillPick(e.position, 1, 6, 6);
    const hit = picked.find((p) => defined(p) && isPickId(p.id));
    onPick(hit ? (hit.id as PickId) : null);
  }, ScreenSpaceEventType.LEFT_CLICK);

  // Cursor de mano al pasar por encima de un objeto.
  const hover = new ScreenSpaceEventHandler(viewer.scene.canvas);
  hover.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => {
    const p = viewer.scene.pick(e.endPosition);
    viewer.canvas.style.cursor = defined(p) && isPickId(p.id) ? 'pointer' : 'default';
  }, ScreenSpaceEventType.MOUSE_MOVE);
}
