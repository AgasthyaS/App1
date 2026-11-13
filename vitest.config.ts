import path from 'node:path';
import { defineConfig } from 'vitest/config';

const stub = (f: string) => path.resolve(__dirname, 'tests/stubs', f);

export default defineConfig({
  resolve: {
    // The edge function's shared modules import each other with a `.ts` suffix (Deno requires it).
    extensions: ['.ts', '.tsx', '.js', '.json'],
    alias: [
      // Native-only packages the logic under test imports but never calls.
      { find: /^react-native$/, replacement: stub('react-native.ts') },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: stub('async-storage.ts') },
      { find: /^react-native-url-polyfill\/auto$/, replacement: stub('empty.ts') },
      { find: /^@\//, replacement: `${path.resolve(__dirname)}/` },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
