// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // `dist/*` is the web export; `Eastbay-Venture` is a SEPARATE Next.js project
    // that happens to share this repo — it has its own toolchain and isn't part
    // of the Greenr app, so it shouldn't be linted with the Expo config.
    ignores: ['dist/*', 'Eastbay-Venture/**'],
  },
  {
    rules: {
      // React-DOM-only rule: it flags plain apostrophes in copy ("It's"), which
      // render perfectly fine in React Native <Text>. Not applicable here.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
