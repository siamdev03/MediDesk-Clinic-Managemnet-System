import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:5001'; // server/.env er PORT er sathe mil rakho

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/uploads': API,
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
});