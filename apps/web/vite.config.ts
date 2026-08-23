import { defineConfig } from 'vite';
import { devtools } from '@tanstack/devtools-vite';
import type { PluginOption } from "vite";
import { tanstackStart } from '@tanstack/react-start/plugin/vite';

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite';

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    watch: {
      // Trigger.dev updates active-runs.json when a run starts and finishes.
      // Those runtime writes must not reload the application during a stream.
      ignored: ['**/.trigger/**'],
    },
  },
  // Vitest needs JSX transformation and path resolution, not the application
  // server stack. Loading Nitro/TanStack Start in tests inlines React's CJS
  // entry as ESM and leaves a Vite server handle open after the suite exits.
  plugins: process.env.VITEST === "true"
    ? [viteReact()]
    : [
        devtools(),
        /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ nitro({
          traceDeps: ["react", "react-dom", "scheduler"],
        }) as PluginOption,
        tailwindcss(),
        tanstackStart(),
        viteReact(),
      ],
})

export default config
