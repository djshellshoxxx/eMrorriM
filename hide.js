(() => {
  'use strict';
  const { $, enc, dec, save, status } = window.TK;

  const ITER = 600000;          // PBKDF2-SHA256 iterations
  const SALT = 16, IV = 12, LEN = 4;
  const HEADER = SALT + IV + LEN;
  const MAX_PIXELS = 16000000;

  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Draw the picture onto an opaque canvas so every pixel keeps exact RGB values.
  async function loadPixels(file) {
    const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    if (bmp.width * bmp.height > MAX_PIXELS) throw new Error('Image is too large (max 16 megapixels).');
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return { canvas, ctx, img: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  }

  // Bit k lives in the lowest bit of the k-th R/G/B byte (alpha is skipped).
  const slot = k => Math.floor(k / 3) * 4 + (k % 3);

  function writeBits(data, bytes, offsetBits) {
    let k = offsetBits;
    for (let i = 0; i < bytes.length; i++) {
      for (let b = 7; b >= 0; b--, k++) {
        const j = slot(k);
        data[j] = (data[j] & 0xfe) | ((bytes[i] >> b) & 1);
      }
    }
    return k;
  }

  function readBytes(data, offsetBits, count) {
    const out = new Uint8Array(count);
    let k = offsetBits;
    for (let i = 0; i < count; i++) {
      let v = 0;
      for (let b = 0; b < 8; b++, k++) v = (v << 1) | (data[slot(k)] & 1);
      out[i] = v;
    }
    return out;
  }

  function fillNoise(data, fromBit, totalBits) {
    const need = totalBits - fromBit;
    const rnd = new Uint8Array(Math.ceil(need / 8));
    for (let o = 0; o < rnd.length; o += 65536) crypto.getRandomValues(rnd.subarray(o, o + 65536));
    for (let i = 0; i < need; i++) {
      const j = slot(fromBit + i);
      data[j] = (data[j] & 0xfe) | ((rnd[i >> 3] >> (i & 7)) & 1);
    }
  }

  $('hGo').addEventListener('click', async () => {
    const file = $('hCover').files[0];
    const msg = $('hMsg').value;
    const pass = $('hPass').value;
    if (!file) return status('hStatus', 'Choose a cover image first.', true);
    if (!msg) return status('hStatus', 'Type a message to hide.', true);
    if (!pass) return status('hStatus', 'Choose a passphrase.', true);
    try {
      status('hStatus', 'Working... (key derivation takes a moment)');
      const { canvas, ctx, img } = await loadPixels(file);
      const totalBits = canvas.width * canvas.height * 3;

      const salt = crypto.getRandomValues(new Uint8Array(SALT));
      const iv = crypto.getRandomValues(new Uint8Array(IV));
      const key = await deriveKey(pass, salt);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(msg)));

      const payload = new Uint8Array(HEADER + ct.length);
      payload.set(salt, 0);
      payload.set(iv, SALT);
      new DataView(payload.buffer).setUint32(SALT + IV, ct.length);
      payload.set(ct, HEADER);

      const capacity = Math.floor(totalBits / 8) - HEADER - 16;
      if (payload.length * 8 > totalBits) {
        return status('hStatus', 'Message too long for this picture. This image holds about ' + Math.max(capacity, 0) + ' characters; pick a bigger image.', true);
      }
      const end = writeBits(img.data, payload, 0);
      if ($('hNoise').checked) fillNoise(img.data, end, totalBits);
      ctx.putImageData(img, 0, 0);

      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      save(blob, 'picture.png');
      status('hStatus', 'Done. Saved picture.png with your message inside (' + payload.length + ' bytes used of about ' + (capacity + HEADER + 16) + '). Send it as a file, never as a compressed photo.');
    } catch (e) {
      status('hStatus', 'Failed: ' + e.message, true);
    }
  });

  $('rGo').addEventListener('click', async () => {
    $('rOut').value = '';
    const file = $('rFile').files[0];
    const pass = $('rPass').value;
    if (!file) return status('rStatus', 'Choose the image first.', true);
    if (!pass) return status('rStatus', 'Enter the passphrase.', true);
    const fail = () => status('rStatus', 'Nothing could be revealed: wrong passphrase, or no hidden message in this image.', true);
    try {
      status('rStatus', 'Working...');
      const { canvas, img } = await loadPixels(file);
      const totalBits = canvas.width * canvas.height * 3;
      if (totalBits < HEADER * 8) return fail();

      const head = readBytes(img.data, 0, HEADER);
      const ctLen = new DataView(head.buffer).getUint32(SALT + IV);
      if (ctLen < 16 || (HEADER + ctLen) * 8 > totalBits) return fail();
      const ct = readBytes(img.data, HEADER * 8, ctLen);

      const key = await deriveKey(pass, head.slice(0, SALT));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: head.slice(SALT, SALT + IV) }, key, ct);
      $('rOut').value = dec.decode(plain);
      status('rStatus', 'Message revealed.');
    } catch (e) {
      fail();
    }
  });
})();
