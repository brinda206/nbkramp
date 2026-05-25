import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    // Only expose VITE_* prefixed vars to the client bundle
    // Server-side secrets (SUPABASE_SERVICE_ROLE_KEY, OWLPAY_API_KEY, etc.)
    // are never included here — they live in process.env on the server only
    define: {
      // No secrets injected into client bundle
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
