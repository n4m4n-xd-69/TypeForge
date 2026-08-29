import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  test: {
    environment: 'node',
    // The Edge Function modules are TypeScript and live outside src/, but they
    // are plain Web-standard code (fetch, ReadableStream, TextDecoder) with no
    // Deno-only imports, so they run here rather than needing a second runner.
    // Anything Deno-specific lives in a function entrypoint, which is not
    // covered by this glob.
    include: ['src/**/*.test.js', 'supabase/functions/**/*.test.ts'],
  },
});
