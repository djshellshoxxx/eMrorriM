# Architecture Summary

From the README.

- **Static page.** Host the folder on any static host. There is no server component (README "Host it").
- **Vendored libraries.** `vendor.js` is a bundle of third-party libraries built from `build/` (`npm ci && npm run build`). The README lists them.
- **One file per tab.** `wallet.js`, `split.js`, `hide.js`, `pgp.js`, `chat.js`, `mirror.js`, with shared code in `core.js`.
- **Offline support.** `sw.js` and `manifest.json` provide the offline PWA install.
- **File lists.** `mirror.js` and `sw.js` each hold a file list; the README asks that both be updated when a file is added or renamed.
