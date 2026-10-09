(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  function unb64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function unb64url(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return unb64(s);
  }

  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  // Show a message in a status element. bad=true colours it as an error.
  function status(id, text, bad) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  }

  const kb = n => (n / 1024).toFixed(1) + ' KB';

  /* ---------- tabs ---------- */
  const tabBtns = Array.from(document.querySelectorAll('#tabs [data-tab]'));
  function show(name) {
    if (!tabBtns.some(b => b.dataset.tab === name)) name = 'wallet';
    for (const b of tabBtns) {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      $('tab-' + b.dataset.tab).hidden = !on;
    }
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
  }
  for (const b of tabBtns) b.addEventListener('click', () => show(b.dataset.tab));
  show(location.hash.replace('#', ''));

  /* ---------- copy buttons: <button class="copy" data-copy="elementId"> ---------- */
  for (const b of document.querySelectorAll('button.copy')) {
    b.addEventListener('click', async () => {
      const t = $(b.dataset.copy).value;
      if (!t) return;
      const old = b.textContent;
      b.textContent = (await copyText(t)) ? 'Copied' : 'Select and copy manually';
      setTimeout(() => { b.textContent = old; }, 1500);
    });
  }

  /* ---------- online banner (wallet tab) ---------- */
  function paintNet() {
    const on = navigator.onLine;
    $('net').className = 'dot ' + (on ? 'on' : 'off');
    $('netTxt').textContent = on ? 'online' : 'offline';
    for (const el of document.querySelectorAll('.netwarn')) {
      el.textContent = on
        ? 'You are online. For real funds, turn off wifi/data and unplug the network before generating keys.'
        : 'You are offline. Good. Keep it that way while you handle keys.';
      el.classList.toggle('warn', on);
      el.classList.toggle('ok', !on);
    }
  }
  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  paintNet();

  // Disable a tool's buttons if the crypto bundle failed to load.
  const vendorOk = !!window.CP;
  if (!vendorOk) {
    for (const b of document.querySelectorAll('#tab-wallet button, #tab-split button, #tab-pgp button.primary')) b.disabled = true;
    const hdr = document.querySelector('header .tag');
    hdr.textContent = 'vendor.js failed to load, so wallet, split and PGP are disabled. Re-download the toolkit.';
  }

  window.TK = { $, enc, dec, b64, unb64, b64url, unb64url, save, copyText, status, kb, vendorOk };
})();
