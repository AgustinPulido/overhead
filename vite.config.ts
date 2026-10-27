import { defineConfig, loadEnv } from 'vite';
import cesium from 'vite-plugin-cesium';

const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

/**
 * Si hay credenciales OAuth2 de OpenSky en .env, el proxy pide un token y lo
 * renueva antes de que expire. Así el secreto queda en el dev server y nunca
 * llega al navegador. Sin credenciales, las peticiones van anónimas.
 */
function createOpenSkyTokenManager(clientId?: string, clientSecret?: string) {
  let token: string | null = null;
  if (!clientId || !clientSecret) return { get: () => token };

  const refresh = async () => {
    try {
      const res = await fetch(OPENSKY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { access_token: string; expires_in: number };
      token = data.access_token;
      // Renovar un minuto antes de que venza.
      setTimeout(refresh, Math.max(60, data.expires_in - 60) * 1000);
      console.log('[opensky] token OAuth2 obtenido');
    } catch (err) {
      token = null;
      console.warn('[opensky] no se pudo obtener token, sigo en modo anónimo:', err);
      setTimeout(refresh, 5 * 60 * 1000);
    }
  };
  void refresh();
  return { get: () => token };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'OPENSKY_');
  const openskyToken = createOpenSkyTokenManager(env.OPENSKY_CLIENT_ID, env.OPENSKY_CLIENT_SECRET);

  return {
    plugins: [cesium()],
    worker: { format: 'es' },
    // satellite.js 7 incluye un build WASM que usa top-level await.
    build: { target: 'es2022' },
    optimizeDeps: { esbuildOptions: { target: 'es2022' } },
    server: {
      proxy: {
        '/api/celestrak': {
          target: 'https://celestrak.org',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/celestrak/, ''),
        },
        '/api/opensky': {
          target: 'https://opensky-network.org',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/opensky/, '/api'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const t = openskyToken.get();
              if (t) proxyReq.setHeader('Authorization', `Bearer ${t}`);
            });
          },
        },
      },
    },
  };
});
