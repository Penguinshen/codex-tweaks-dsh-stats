import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  esbuild: { jsx: 'automatic' },
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: {
    lib: {
      entry: 'src/inject.ts',
      name: 'CodexDshStatsBundle',
      formats: ['iife'],
      fileName: 'desktop',
      cssFileName: 'desktop',
    },
  },
}))

