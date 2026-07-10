import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import type { PluginOption } from "vite";
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    watch: {
      // Trigger.dev updates active-runs.json when a run starts and finishes.
      // Those runtime writes must not reload the application during a stream.
      ignored: ['**/.trigger/**'],
    },
  },
  plugins: [
    devtools(),
    nitro({
      traceDeps: ["react", "react-dom", "scheduler"],
    }) as PluginOption,
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
