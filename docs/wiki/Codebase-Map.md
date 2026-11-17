# Codebase Map

| I want to... | Look in |
|---|---|
| Page and styles | `index.html`, `style.css` |
| Wallet tab | `wallet.js` |
| Secret sharing tab | `split.js` |
| Hide (steganography) tab | `hide.js` |
| PGP tab | `pgp.js` |
| Chat tab (WebRTC) | `chat.js` |
| Mirror tab (download and installer) | `mirror.js` |
| Shared code | `core.js` |
| Vendored libraries | `vendor.js` (built from `build/`) |
| Offline support | `sw.js`, `manifest.json`, `icon.svg` |
| Build recipe for `vendor.js` | `build/` (`build.mjs`, `entry.js`, `package.json`); not part of the shipped site |
