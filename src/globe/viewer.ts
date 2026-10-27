import {
  ArcGisMapServerImageryProvider,
  buildModuleUrl,
  Cartesian3,
  Color,
  Credit,
  ImageryLayer,
  Ion,
  OpenStreetMapImageryProvider,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium';

export type BaseMap = 'esri' | 's2cloudless' | 'bluemarble' | 'naturalearth' | 'osm';

export const BASE_MAPS: { id: BaseMap; label: string }[] = [
  { id: 'esri', label: 'Satélite (Esri)' },
  { id: 's2cloudless', label: 'Sentinel-2 sin nubes' },
  { id: 'bluemarble', label: 'NASA Blue Marble' },
  { id: 'naturalearth', label: 'Natural Earth II (offline)' },
  { id: 'osm', label: 'OpenStreetMap' },
];

export const DEFAULT_BASE_MAP: BaseMap = 'esri';

// No usamos Cesium Ion: vaciamos el token para que nada intente pedirlo.
Ion.defaultAccessToken = '';

/** Ninguna de estas fuentes necesita token. */
function createLayer(map: BaseMap): ImageryLayer {
  switch (map) {
    case 'esri':
      // Mosaico satelital mundial; llega a resolución submétrica en ciudades.
      return ImageryLayer.fromProviderAsync(
        ArcGisMapServerImageryProvider.fromUrl(
          'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
        ),
      );
    case 's2cloudless':
      // Sentinel-2 a 10 m/px, sin nubes. Licencia CC BY-NC-SA 4.0 (no comercial).
      return new ImageryLayer(
        new UrlTemplateImageryProvider({
          url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
          maximumLevel: 15,
          credit: new Credit(
            'Sentinel-2 cloudless – <a href="https://s2maps.eu" target="_blank">s2maps.eu</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)',
          ),
        }),
      );
    case 'bluemarble':
      // Dominio público, pero solo hasta nivel 8 (~500 m/px): ideal para vista global.
      return new ImageryLayer(
        new UrlTemplateImageryProvider({
          url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
          maximumLevel: 8,
          credit: new Credit('NASA Blue Marble · GIBS / Worldview'),
        }),
      );
    case 'osm':
      return new ImageryLayer(new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }));
    case 'naturalearth':
      return ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
      );
  }
}

export function createViewer(container: string | HTMLElement): Viewer {
  const viewer = new Viewer(container, {
    baseLayer: createLayer(DEFAULT_BASE_MAP),
    // Todos estos widgets dependen de Ion o no los necesitamos.
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: false,
    // Renderizar a la resolución nativa de la pantalla (en HiDPI se ve mucho más nítido).
    useBrowserRecommendedResolution: false,
    msaaSamples: 4,
  });

  const { scene } = viewer;
  scene.globe.enableLighting = false;
  scene.globe.baseColor = Color.fromCssColorString('#0b1a2e');
  // Por defecto es 2; más bajo carga tiles más detallados antes (algo más de red y GPU).
  scene.globe.maximumScreenSpaceError = 1.5;
  scene.backgroundColor = Color.BLACK;
  // Permitir alejarse lo suficiente para ver la órbita geoestacionaria.
  scene.screenSpaceCameraController.maximumZoomDistance = 2.5e8;

  viewer.camera.setView({ destination: Cartesian3.fromDegrees(-60, 0, 2.2e7) });
  return viewer;
}

export function setBaseMap(viewer: Viewer, map: BaseMap): void {
  const layers = viewer.imageryLayers;
  const base = layers.get(0);
  if (base) layers.remove(base, true);
  layers.add(createLayer(map), 0);
}
