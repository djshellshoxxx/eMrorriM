(() => {
  'use strict';
  const { $, enc, dec, b64url, unb64url, status, copyText, vendorOk } = window.TK;
  if (!vendorOk) return;
  const CP = window.CP;

  const MAX_SECRET = 2000; // bytes
  const CHECK = 4;         // checksum bytes appended before splitting
  const SHARE_RE = /^cpk1-(\d+)of(\d+)-([A-Za-z0-9_-]+)$/;

  const checksum = bytes => CP.sha256(bytes).slice(0, CHECK);

  function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function renderShares(shares, k, n) {
    const ol = $('sShares');
    ol.textContent = '';
    shares.forEach((sh, i) => {
      const text = 'cpk1-' + k + 'of' + n + '-' + b64url(sh);
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'path';
      label.textContent = 'Share ' + (i + 1) + ' of ' + n;
      const code = document.createElement('code');
      code.textContent = text;
      const copy = document.createElement('button');
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => {
        copy.textContent = (await copyText(text)) ? 'Copied' : 'Select manually';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
      });
      const qrBtn = document.createElement('button');
      qrBtn.textContent = 'QR';
      const qr = document.createElement('div');
      qr.className = 'qr';
      qr.hidden = true;
      qrBtn.addEventListener('click', () => {
        if (qr.hidden && !qr.firstChild) qr.innerHTML = CP.qrSvg(text);
        qr.hidden = !qr.hidden;
      });
      li.append(label, code, copy, qrBtn, qr);
      ol.appendChild(li);
    });
  }

  $('sSplit').addEventListener('click', async () => {
    const secret = enc.encode($('sSecret').value);
    const n = parseInt($('sN').value, 10);
    const k = parseInt($('sK').value, 10);
    if (!secret.length) return status('sStatus', 'Enter a secret to split.', true);
    if (secret.length > MAX_SECRET) return status('sStatus', 'Secret is too long (max ' + MAX_SECRET + ' bytes).', true);
    if (!(n >= 2 && n <= 20) || !(k >= 2 && k <= n)) {
      return status('sStatus', 'Choose 2 <= K <= N <= 20.', true);
    }
    try {
      const shares = await CP.shamir.split(concat(secret, checksum(secret)), n, k);
      renderShares(shares, k, n);
      status('sStatus', 'Done. Any ' + k + ' of these ' + n + ' shares rebuild the secret. Fewer than ' + k + ' reveal nothing. Store them in separate places.');
    } catch (e) {
      status('sStatus', 'Split failed: ' + e.message, true);
    }
  });

  $('sCombine').addEventListener('click', async () => {
    $('sOut').value = '';
    const lines = $('sIn').value.split(/\s+/).filter(Boolean);
    if (!lines.length) return status('sStatus', 'Paste your shares first.', true);

    const parsed = [];
    for (const line of lines) {
      const m = SHARE_RE.exec(line);
      if (!m) return status('sStatus', 'This is not a valid share: ' + line.slice(0, 24) + '...', true);
      parsed.push({ k: +m[1], n: +m[2], bytes: unb64url(m[3]) });
    }
    const { k, n } = parsed[0];
    if (parsed.some(p => p.k !== k || p.n !== n)) {
      return status('sStatus', 'These shares come from different splits (their K/N labels differ).', true);
    }
    const unique = new Set(lines);
    if (unique.size !== lines.length) return status('sStatus', 'The same share was pasted more than once.', true);
    if (parsed.length < k) {
      return status('sStatus', 'You need at least ' + k + ' shares; you pasted ' + parsed.length + '.', true);
    }
    try {
      const joined = await CP.shamir.combine(parsed.map(p => p.bytes));
      const secret = joined.slice(0, joined.length - CHECK);
      const sum = joined.slice(joined.length - CHECK);
      const want = checksum(secret);
      if (joined.length <= CHECK || sum.some((v, i) => v !== want[i])) {
        return status('sStatus', 'Recovery failed: a share is wrong, damaged, or from another split.', true);
      }
      $('sOut').value = dec.decode(secret);
      status('sStatus', 'Secret recovered and verified.');
    } catch (e) {
      status('sStatus', 'Recovery failed: ' + e.message, true);
    }
  });

  $('sClear').addEventListener('click', () => {
    for (const id of ['sSecret', 'sIn', 'sOut']) $(id).value = '';
    $('sShares').textContent = '';
    status('sStatus', 'Screen cleared.');
  });
})();
