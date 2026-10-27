# Overhead

Globo 3D con satélites y aviones en tiempo real. Vite + TypeScript + CesiumJS, con
órbitas propagadas por SGP4 ([satellite.js](https://github.com/shashwatak/satellite-js))
y datos de [CelesTrak](https://celestrak.org) y [OpenSky Network](https://opensky-network.org).

No usa Cesium Ion ni requiere tokens: los mapas base son fuentes públicas (Esri World
Imagery por defecto, Sentinel-2 cloudless, NASA Blue Marble, OpenStreetMap) más
Natural Earth II, que viene incluido en Cesium y funciona offline.

## Cómo correrlo

Requisitos: Node 18+ (probado con Node 24).

```bash
npm install
npm run dev
```

Abrí http://localhost:5173.

Otros scripts:

| Script              | Qué hace                                          |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Dev server con proxy para CelesTrak y OpenSky     |
| `npm run typecheck` | Chequeo de tipos con `tsc`                        |
| `npm run build`     | Typecheck + build de producción en `dist/`        |
| `npm run preview`   | Sirve `dist/` (ver la nota sobre el proxy abajo)  |

### Parámetros de URL

- `?group=<grupo>`: grupo de CelesTrak a cargar en lugar de `active`. Por ejemplo
  `?group=stations`, `?group=starlink`, `?group=gnss`, `?group=geo`. Cada grupo
  tiene su propia caché.

### Credenciales de OpenSky (opcional)

Sin credenciales, OpenSky funciona en modo anónimo, con un cupo diario muy bajo (ver
abajo). Para tener más cupo:

1. Creá una cuenta en opensky-network.org y generá un *API client* (Account → API Client).
2. Copiá `.env.example` a `.env` y completá `OPENSKY_CLIENT_ID` y `OPENSKY_CLIENT_SECRET`.
3. Reiniciá `npm run dev`.

El dev server pide el token OAuth2 y lo agrega en el proxy, así que el secreto nunca
llega al navegador.

## Estructura

```
src/
  globe/       Viewer de Cesium, mapa base, picking (clics sobre objetos)
  satellites/  Descarga y caché de TLE, worker SGP4, capa de puntos y órbita
  aircraft/    Cliente de OpenSky, capa de íconos, rastros y estima de posición
  ui/          Panel de controles, buscador, panel de información
  main.ts      Conecta todo: selección, cámara, contadores, estados de error
```

### Cómo funciona

- **Satélites**: los TLE se guardan en `localStorage` por 2 horas. Un Web Worker
  propaga todas las órbitas con SGP4 cada segundo y devuelve las posiciones ECEF en
  `Float64Array` transferibles. Se dibujan con una `PointPrimitiveCollection`. Si el
  worker todavía no terminó un cálculo, el tick siguiente se saltea.
- **Clasificación**: por altitud media (semieje mayor): LEO < 2.000 km, MEO hasta
  34.000 km y GEO por encima de eso. Las órbitas muy excéntricas (Molniya, GTO) caen
  en MEO o GEO según su semieje.
- **Órbita**: al seleccionar un satélite, el worker calcula un período completo (360
  muestras) en un marco inercial fijado a la rotación terrestre actual, así se ve como
  una elipse cerrada que pasa por el satélite.
- **Aviones**: se consulta `/api/states/all` cada 15 s. Se muestran solo los que están
  en vuelo, como íconos orientados según su rumbo y coloreados por altitud. Entre una
  consulta y otra la posición se estima a partir de velocidad, rumbo y velocidad
  vertical (hasta 60 s). Se guardan los últimos 40 reportes de cada avión para el rastro.
- **Errores de red**: si CelesTrak falla se usa la caché aunque esté vencida. Si OpenSky
  falla o tarda más de 20 s, se reintenta en el próximo ciclo. Ante un 429 se espera el
  tiempo que indica la API. Todos los estados se muestran en el panel.

## Limitaciones de las APIs gratuitas

### OpenSky Network

- **Cupo anónimo**: 400 créditos por día. Una consulta global a `/states/all` cuesta
  4 créditos, o sea **~100 consultas por día**: cada 15 s, eso dura **unos 25 minutos**.
  Después la API responde 429 hasta el día siguiente (la app lo muestra y espera).
  Con cuenta, el cupo sube a 4.000 créditos por día (~4 h de uso continuo); quienes
  aportan un receptor ADS-B tienen 8.000.
- Para ahorrar créditos, la app **no consulta** mientras la pestaña está oculta o la
  capa de aviones está apagada.
- Los datos anónimos tienen 10 s de resolución y solo traen estados actuales: no hay
  historial, por eso el rastro empieza a armarse cuando abrís la app.
- La cobertura depende de receptores voluntarios: hay huecos sobre océanos, África y
  partes de Asia.
- Solo da el país de registro: no trae aerolínea, modelo ni origen y destino.
- Uso no comercial, según sus términos.

### CelesTrak

- Los datos GP se actualizan cada ~2 horas. CelesTrak **bloquea por IP** a quien
  descarga lo mismo repetidamente antes de que haya datos nuevos. Por eso la caché de
  2 h es importante: no la borres a cada rato. Si te bloquean, la app usa la última
  caché que tenga.
- El formato TLE solo tiene nombre, NORAD ID y designador internacional: no trae
  operador ni país. El botón "Más info" lleva al SATCAT de CelesTrak.
- SGP4 pierde precisión a medida que el TLE envejece (del orden de km por día en LEO).
- El grupo `active` tiene unos 12.000 objetos y pesa ~2 MB. Si `localStorage` no tiene
  espacio, la app funciona igual, pero sin caché.

### Proxy y producción

El proxy que evita los problemas de CORS es del **dev server de Vite** (`server.proxy`
en `vite.config.ts`). `npm run build` genera archivos estáticos sin proxy: para
publicarlo hay que replicar las rutas `/api/celestrak` y `/api/opensky` en el hosting
(rewrites de Netlify o Vercel, una función serverless, nginx, etc.).

### Mapa base

Se elige desde el selector del panel. Ninguna opción requiere token.

| Mapa                   | Resolución máx.            | Notas                                                                                     |
| ---------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| Satélite (Esri)        | submétrica en ciudades     | Por defecto. Uso sujeto a los [términos de Esri](https://www.esri.com/en-us/legal/terms/full-master-agreement); requiere atribución (Cesium la muestra) |
| Sentinel-2 sin nubes   | 10 m/px                    | De EOX, colores muy parejos. Licencia CC BY-NC-SA 4.0: **no comercial**                       |
| NASA Blue Marble       | ~500 m/px (nivel 8)        | Dominio público. Se ve muy bien de lejos, pero borroso al acercarse                         |
| Natural Earth II       | muy baja                   | Viene incluido en Cesium y funciona sin internet                                           |
| OpenStreetMap          | calles                     | La [política de uso](https://operations.osmfoundation.org/policies/tiles/) de `tile.openstreetmap.org` no permite tráfico intenso |

Además, el globo se renderiza a la resolución nativa de la pantalla
(`useBrowserRecommendedResolution: false`) y con `maximumScreenSpaceError = 1.5`, así
se cargan antes los tiles detallados. En GPUs modestas o pantallas 4K puede bajar
los FPS: si pasa, volvé esas opciones a sus valores por defecto en
[src/globe/viewer.ts](src/globe/viewer.ts).
