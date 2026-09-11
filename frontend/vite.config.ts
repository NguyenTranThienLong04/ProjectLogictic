import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const productionUrlKeys = ['VITE_API_URL', 'VITE_SOCKET_URL', 'VITE_API_DOCS_URL'] as const;

function validateProductionEnvironment(environment: Record<string, string>): void {
  for (const key of productionUrlKeys) {
    const value = process.env[key] ?? environment[key];
    if (!value) continue;
    const url = new URL(value, 'https://frontend.invalid');
    if (url.protocol !== 'https:') throw new Error(`${key} must use HTTPS in production`);
    if (url.username || url.password) throw new Error(`${key} must not contain credentials`);
    if (
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname.startsWith('127.') ||
      url.hostname === '[::1]' ||
      url.hostname === '0.0.0.0'
    ) {
      throw new Error(`${key} must not point to localhost in production`);
    }
  }
  const locationMode = process.env.VITE_LOCATION_MODE ?? environment.VITE_LOCATION_MODE;
  if (locationMode === 'SIMULATION') {
    throw new Error('VITE_LOCATION_MODE must be REAL in production');
  }
}

export default defineConfig(({ mode }) => {
  const envDir = '..';
  const environment = loadEnv(mode, envDir, '');
  if (mode === 'production') validateProductionEnvironment(environment);

  const backendPort = process.env.PORT ?? environment.PORT ?? '3000';
  if (!/^\d+$/.test(backendPort) || Number(backendPort) < 1 || Number(backendPort) > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy:
        mode === 'development'
          ? {
              '/api': {
                target: `http://localhost:${backendPort}`,
              },
              '/socket.io': {
                target: `http://localhost:${backendPort}`,
                ws: true,
              },
            }
          : undefined,
    },
  };
});
