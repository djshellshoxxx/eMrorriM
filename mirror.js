(() => {
  'use strict';
  const { $, enc, dec, b64, unb64, save, copyText, status, kb } = window.TK;

  // Every file that makes up this site. Keep in sync with sw.js.
  const FILES = [
    'index.html', 'style.css', 'vendor.js', 'core.js', 'wallet.js', 'split.js',
    'hide.js', 'pgp.js', 'mirror.js', 'manifest.json', 'icon.svg', 'sw.js'
  ];
  const DIR = 'cypherpunk-toolkit';
  const say = (t, bad) => status('mirrorMsg', t, bad);

  /* ---------- SHA-256 (pure JS so it works on plain http too) ---------- */
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256(bytes) {
    const len = bytes.length;
    const padLen = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(padLen);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(padLen - 8, Math.floor(len / 0x20000000));
    dv.setUint32(padLen - 4, (len << 3) >>> 0);

    const h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    const w = new Uint32Array(64);

    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d;
      h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    return Array.from(h, x => x.toString(16).padStart(8, '0')).join('');
  }

  /* ---------- ZIP writer (stored, no compression, deterministic) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function buildZip(files) {
    const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1; // fixed date so every zip is byte-identical
    const DOS_TIME = 0;
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, DOS_TIME, true);
      lh.setUint16(12, DOS_DATE, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, f.data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, DOS_TIME, true);
      ch.setUint16(14, DOS_DATE, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + size;
    }

    let centralSize = 0;
    for (const c of central) centralSize += c.length;

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);

    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  /* ---------- getting this site's own files ---------- */
  let filesP = null;
  function loadFiles() {
    if (filesP) return filesP;
    const bundle = $('bundle'); // present in the single-file build
    if (bundle) {
      filesP = Promise.resolve(JSON.parse(bundle.textContent).map(x => ({ name: x.n, data: unb64(x.d) })));
    } else {
      filesP = Promise.all(FILES.map(n =>
        fetch(n, { cache: 'no-cache' }).then(r => {
          if (!r.ok) throw new Error(n + ' returned ' + r.status);
          return r.arrayBuffer();
        }).then(buf => ({ name: n, data: new Uint8Array(buf) }))
      ));
    }
    return filesP;
  }
  const byName = (files, n) => files.find(f => f.name === n).data;

  function readmeFile() {
    return {
      name: 'README-REHOST.txt',
      data: enc.encode([
        'CYPHERPUNK TOOLKIT - how to host this copy',
        '',
        'This folder is a complete static website. There is nothing to install or build.',
        '',
        'Quick test on your own machine:',
        '    python3 -m http.server 8080',
        '    then open http://localhost:8080/',
        '',
        'To put it online, upload every file in this folder to any static host:',
        'GitHub Pages, Netlify, Cloudflare Pages, an nginx/Caddy box, or IPFS.',
        '',
        'Keep the files together and unmodified so the hashes on the Mirror tab still match.',
        ''
      ].join('\n'))
    };
  }

  /* ---------- the three export formats ---------- */
  function buildSingle(files) {
    const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; form-action 'none'; base-uri 'none'";
    const closeScript = '<' + '/script>';
    const bundle = JSON.stringify(files.map(f => ({ n: f.name, d: b64(f.data) })));
    let html = dec.decode(byName(files, 'index.html'));
    const css = dec.decode(byName(files, 'style.css'));
    const icon = 'data:image/svg+xml;base64,' + b64(byName(files, 'icon.svg'));
    let first = true;

    html = html
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, () => '<meta http-equiv="Content-Security-Policy" content="' + csp + '">')
      .replace(/<link rel="manifest"[^>]*>\n?/, () => '')
      .replace(/<link rel="icon"[^>]*>/, () => '<link rel="icon" href="' + icon + '">')
      .replace(/<link rel="stylesheet" href="style\.css">/, () => '<style>' + css + '</style>')
      .replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
        // Defence in depth: a literal "</script" inside inlined code would end the tag early.
        const code = dec.decode(byName(files, src)).replace(/<\/script/gi, '<\\/script');
        const prefix = first ? '<script type="application/json" id="bundle">' + bundle + closeScript : '';
        first = false;
        return prefix + '<script>' + code + closeScript;
      });
    return new Blob([html], { type: 'text/html' });
  }

  function wrap(str, n) {
    const out = [];
    for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n));
    return out.join('\n');
  }

  async function gzip(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Safe to paste straight into an interactive shell: everything runs inside a subshell,
  // so "set -e" can never close your terminal session.
  async function buildScript(files) {
    const all = files.concat([readmeFile()]);
    let s = '(\nset -e\nD=' + DIR + '\nmkdir -p "$D"\ncd "$D"\n';
    for (const f of all) {
      const gz = await gzip(f.data);
      if (gz && gz.length < f.data.length) {
        s += 'base64 -d <<\'MIRROR_EOF\' | gunzip > "' + f.name + '"\n' + wrap(b64(gz), 76) + '\nMIRROR_EOF\n';
      } else {
        s += 'base64 -d > "' + f.name + '" <<\'MIRROR_EOF\'\n' + wrap(b64(f.data), 76) + '\nMIRROR_EOF\n';
      }
    }
    s += 'if command -v sha256sum >/dev/null 2>&1; then\nsha256sum -c <<\'MIRROR_SUMS\'\n';
    for (const f of all) s += sha256(f.data) + '  ' + f.name + '\n';
    s += 'MIRROR_SUMS\nfi\n';
    s += 'echo\necho "Done. Files are in: $(pwd)"\necho "Serve them with:  cd ' + DIR + ' && python3 -m http.server 8080"\n)\n';
    return s;
  }

  /* ---------- buttons ---------- */
  let zipBlob = null;

  async function prepare() {
    const files = await loadFiles();
    if (!zipBlob) zipBlob = buildZip(files.concat([readmeFile()]));
    return files;
  }

  $('btnZip').addEventListener('click', async () => {
    try {
      const files = await prepare();
      save(zipBlob, DIR + '.zip');
      say('ZIP saved: ' + (files.length + 1) + ' files, ' + kb(zipBlob.size) + '. Unzip and upload to any static host.');
    } catch (e) { say('Could not build the ZIP: ' + e.message, true); }
  });

  $('btnSingle').addEventListener('click', async () => {
    try {
      const files = await loadFiles();
      const blob = buildSingle(files);
      save(blob, DIR + '.html');
      say('Single file saved (' + kb(blob.size) + '). Open it directly or host that one file.');
    } catch (e) { say('Could not build the single file: ' + e.message, true); }
  });

  $('btnScript').addEventListener('click', async () => {
    try {
      const files = await loadFiles();
      say('Building installer...');
      const script = await buildScript(files);
      if (await copyText(script)) {
        say('Copied (' + kb(script.length) + '). Paste into your terminal and press Enter.');
      } else {
        save(new Blob([script], { type: 'text/plain' }), DIR + '-install.sh');
        say('Clipboard blocked here, so the installer was downloaded instead. Run it with: sh ' + DIR + '-install.sh');
      }
    } catch (e) { say('Could not build the installer: ' + e.message, true); }
  });

  $('btnShare').addEventListener('click', async () => {
    try {
      const file = new File([zipBlob], DIR + '.zip', { type: 'application/zip' });
      await navigator.share({ files: [file], title: 'Cypherpunk Toolkit' });
    } catch (e) {
      if (e.name !== 'AbortError') say('Share failed: ' + e.message, true);
    }
  });

  /* ---------- install prompt ---------- */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('btnInstall').hidden = false;
  });
  $('btnInstall').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('btnInstall').hidden = true;
  });

  /* ---------- status line + service worker ---------- */
  const single = !!$('bundle');
  const web = location.protocol === 'http:' || location.protocol === 'https:';
  $('modeTxt').textContent = single ? 'running: single-file copy' : web ? 'running: hosted copy' : 'running: local files';

  if (single) {
    $('swTxt').textContent = 'offline cache: not needed (everything is in this file)';
  } else if ('serviceWorker' in navigator && web) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => { $('swTxt').textContent = 'offline cache: ready'; })
      .catch(() => { $('swTxt').textContent = 'offline cache: unavailable (needs https or localhost)'; });
  } else {
    $('swTxt').textContent = 'offline cache: unavailable here';
  }

  /* ---------- hash table + share button ---------- */
  (async () => {
    try {
      const files = await prepare();
      const rows = [];
      for (const f of files.slice().sort((a, b) => a.name.localeCompare(b.name))) {
        const h = sha256(f.data);
        rows.push(f.name + '\0' + h);
        const tr = document.createElement('tr');
        for (const t of [f.name, String(f.data.length), h]) {
          const td = document.createElement('td');
          td.textContent = t;
          tr.appendChild(td);
        }
        document.querySelector('#hashes tbody').appendChild(tr);
      }
      $('bundleHash').textContent = sha256(enc.encode(rows.join('\n')));

      if (navigator.canShare && navigator.share) {
        const probe = new File([zipBlob], DIR + '.zip', { type: 'application/zip' });
        if (navigator.canShare({ files: [probe] })) $('btnShare').hidden = false;
      }
    } catch (e) {
      $('bundleHash').textContent = 'unavailable (' + e.message + ')';
    }
  })();
})();
