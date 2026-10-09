# Cypherpunk Toolkit

A single static page that runs entirely in the browser. No server, no accounts, no third-party requests.

| Tab | What it does |
|---|---|
| Wallet | BIP39 recovery phrase + BIP84 native-segwit addresses, QR codes, printable, built-in test-vector self-test |
| Split | Shamir secret sharing (K of N) with a built-in check so wrong or mixed shares are detected |
| Hide | Encrypts a message (AES-256-GCM, PBKDF2) and hides it in a PNG's lowest bits |
| PGP | Generate keys, encrypt, decrypt, sign, verify (OpenPGP, Curve25519) |
| Mirror | Download the site as ZIP, as one HTML file, or as a paste-into-terminal installer; SHA-256 table; installable offline PWA |

## Host it
Put the contents of this folder at the root of any static host (GitHub Pages: Settings, Pages, deploy from branch, `/ (root)`).
Do not upload `build/` (it is only the recipe for `vendor.js`).

## Where the crypto comes from
`vendor.js` is a bundle of audited open-source libraries (`@scure/bip39`, `@scure/bip32`, `@scure/base`, `@noble/hashes`,
`shamir-secret-sharing`, `openpgp`, `qrcode-generator`). Nothing here implements cryptography by hand.
To reproduce it yourself and compare hashes:

    cd build && npm ci && npm run build

## Files
`index.html style.css vendor.js core.js wallet.js split.js hide.js pgp.js mirror.js manifest.json icon.svg sw.js`
If you add or rename a file, update the file lists in `mirror.js` and `sw.js`.

## Honest limits
- A browser tab is not a hardware wallet. For serious funds use clean offline hardware.
- Steganography hides that a message exists from casual observers; specialist analysis may still detect it.
- Mirroring means copies exist elsewhere, but any one host (including GitHub) can still remove its own copy.
