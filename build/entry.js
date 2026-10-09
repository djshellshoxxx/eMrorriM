// Bundles audited libraries into window.CP. Nothing here is custom cryptography.
import { generateMnemonic, validateMnemonic, mnemonicToSeed } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { bech32 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { split, combine } from 'shamir-secret-sharing';
import * as openpgp from 'openpgp';
import qrcode from 'qrcode-generator';

const hash160 = b => ripemd160(sha256(b));
const p2wpkh = pub => bech32.encode('bc', [0, ...bech32.toWords(hash160(pub))]);

// BIP84 native segwit: m/84'/0'/0'/0/i
async function deriveAddresses(mnemonic, passphrase, count) {
  const seed = await mnemonicToSeed(mnemonic, passphrase || '');
  const root = HDKey.fromMasterSeed(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const path = "m/84'/0'/0'/0/" + i;
    out.push({ path, address: p2wpkh(root.derive(path).publicKey) });
  }
  return out;
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

window.CP = {
  wallet: {
    generate: strength => generateMnemonic(wordlist, strength),
    validate: m => validateMnemonic(m, wordlist),
    deriveAddresses
  },
  shamir: { split, combine },
  sha256,
  openpgp,
  qrSvg
};
