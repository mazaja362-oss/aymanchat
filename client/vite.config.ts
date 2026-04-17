import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Same as server PORT so proxy matches when you use e.g. $env:PORT="3001" */
const apiPort = process.env.PORT || '3000';
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/uploads': { target: apiTarget, changeOrigin: true },
      '/socket.io': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
