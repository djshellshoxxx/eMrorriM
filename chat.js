(() => {
  'use strict';
  const { $, enc, dec, b64url, unb64url, status, vendorOk } = window.TK;
  if (!vendorOk) return;
  const CP = window.CP;

  const MAX_TEXT = 4000;        // characters per message
  const MAX_CODE = 30000;       // characters in a pasted handshake code
  const MAX_SDP = 20000;        // characters in the decoded connection description
  const GATHER_MS = 6000;       // how long to wait for network addresses
  const HINT_MS = 20000;        // when to show a "still connecting" hint
  const MAX_NODES = 500;        // messages kept on screen
  const TTLS = [0, 30, 300, 3600];
  const STUN_RE = /^stuns?:[A-Za-z0-9._~:%\-[\]]+$/;

  const say = (t, bad) => status('cStatus', t, bad);

  let pc = null;                // RTCPeerConnection
  let dc = null;                // RTCDataChannel
  let stage = 'idle';
  let verified = false;
  let queue = [];               // messages that arrive before the local user verifies
  const timers = new Set();

  /* ---------- support check ---------- */
  if (typeof RTCPeerConnection !== 'function') {
    status('cSupport', 'This browser does not support peer-to-peer connections (WebRTC), so the chat cannot run here.', true);
    for (const b of document.querySelectorAll('#tab-chat button')) b.disabled = true;
    return;
  }

  /* ---------- stages: show only the blocks that belong to the current step ---------- */
  const blocks = Array.from(document.querySelectorAll('#tab-chat [data-stages]'));
  function setStage(s) {
    stage = s;
    for (const el of blocks) el.hidden = !el.dataset.stages.split(' ').includes(s);
    const lost = s === 'lost';
    $('cInput').disabled = lost;
    $('cSend').disabled = lost;
  }

  /* ---------- handshake codes ---------- */
  async function readCapped(stream, cap) {
    const reader = stream.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) { reader.cancel(); throw new Error('That code is too large to be real.'); }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  async function encodeCode(obj) {
    const raw = enc.encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      const z = await readCapped(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')), MAX_CODE);
      return 'cpkc1z.' + b64url(z);
    }
    return 'cpkc1u.' + b64url(raw);
  }

  async function decodeCode(text, wantType) {
    const t = text.replace(/\s+/g, '');
    const m = /^cpkc1([zu])\.([A-Za-z0-9_-]+)$/.exec(t);
    if (!m || t.length > MAX_CODE) throw new Error('That does not look like a chat code. Copy the whole thing, from "cpkc1" to the end.');
    let bytes;
    try { bytes = unb64url(m[2]); } catch (e) { throw new Error('That code is damaged. Copy it again.'); }
    if (m[1] === 'z') {
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot read compressed codes. Use a newer browser.');
      try {
        bytes = await readCapped(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')), MAX_SDP * 2);
      } catch (e) { throw new Error('That code is damaged or incomplete. Copy it again.'); }
    }
    let obj;
    try { obj = JSON.parse(dec.decode(bytes)); } catch (e) { throw new Error('That code is damaged. Copy it again.'); }
    if (!obj || obj.v !== 1 || typeof obj.sdp !== 'string' || obj.sdp.length > MAX_SDP || !obj.sdp.startsWith('v=0')) {
      throw new Error('That code is not valid.');
    }
    if (obj.t !== wantType) {
      throw new Error(wantType === 'offer'
        ? 'That is a reply code. Here you need the first code your contact started with.'
        : 'That is a starting code. Here you need the reply code your contact sent back.');
    }
    return obj.sdp;
  }

  /* ---------- verification words ---------- */
  // Every DTLS fingerprint in a session description, normalised.
  function fingerprints(sdp) {
    const re = /^a=fingerprint:(\S+) ([0-9A-Fa-f:]+)\s*$/gm;
    const found = [];
    let m;
    while ((m = re.exec(sdp))) found.push(m[1].toLowerCase() + ' ' + m[2].toLowerCase());
    if (!found.length) throw new Error('No security fingerprint was found in the code.');
    return Array.from(new Set(found)).sort().join(',');
  }

  // Both sides hash the same two fingerprints, so both see the same six words
  // unless someone altered the codes in transit. 6 words x 11 bits = 66 bits.
  function sasWords(localSdp, remoteSdp) {
    const pair = [fingerprints(localSdp), fingerprints(remoteSdp)].sort();
    const hash = CP.sha256(enc.encode('cpk-chat-sas-v1|' + pair.join('|')));
    const words = [];
    let acc = 0, bits = 0, i = 0;
    while (words.length < 6) {
      acc = (acc << 8) | hash[i++];
      bits += 8;
      if (bits >= 11) {
        bits -= 11;
        words.push(CP.wordlist[(acc >> bits) & 0x7ff]);
        acc &= (1 << bits) - 1;
      }
    }
    return words;
  }

  /* ---------- connection plumbing ---------- */
  function newPC() {
    const lanOnly = $('cNet').value === 'lan';
    const stun = $('cStun').value.trim();
    if (!lanOnly && stun && !STUN_RE.test(stun)) throw new Error('The STUN address must look like stun:host:port.');
    const p = new RTCPeerConnection({ iceServers: !lanOnly && stun ? [{ urls: stun }] : [] });
    pc = p;
    p.onconnectionstatechange = () => {
      if (p !== pc) return;
      if (p.connectionState === 'failed' || p.connectionState === 'closed') connectionLost();
    };
    p.ondatachannel = e => {
      if (p !== pc) return;
      dc = e.channel;
      bindChannel(dc);
    };
    return p;
  }

  function gather(p) {
    return new Promise(resolve => {
      if (p.iceGatheringState === 'complete') return resolve();
      const t = setTimeout(done, GATHER_MS);
      function done() {
        clearTimeout(t);
        p.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
      function onChange() { if (p.iceGatheringState === 'complete') done(); }
      p.addEventListener('icegatheringstatechange', onChange);
    });
  }

  function bindChannel(ch) {
    ch.onopen = () => { if (ch === dc) goVerify(); };
    ch.onmessage = e => { if (ch === dc) incoming(e.data); };
    ch.onclose = () => { if (ch === dc) connectionLost(); };
  }

  function closePair(d, p) {
    if (d) { d.onopen = d.onmessage = d.onclose = d.onerror = null; try { d.close(); } catch (e) { /* ignore */ } }
    if (p) { p.onconnectionstatechange = p.ondatachannel = null; try { p.close(); } catch (e) { /* ignore */ } }
  }

  // Remove everything the session put on screen or in memory that we control.
  function wipe() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    queue = [];
    verified = false;
    $('cLog').textContent = '';
    $('cSas').textContent = '';
    $('cSasSmall').textContent = '';
    for (const id of ['cInput', 'cOfferOut', 'cReplyIn', 'cOfferIn', 'cAnswerOut']) $(id).value = '';
  }

  // Back to the start. Optionally say a final word to the peer first.
  function resetAll(message, bad, sayBye) {
    const d = dc, p = pc;
    dc = null;
    pc = null;
    if (sayBye && d && d.readyState === 'open') { try { d.send(JSON.stringify({ t: 'bye' })); } catch (e) { /* ignore */ } }
    wipe();
    setStage('idle');
    say(message || '', bad);
    // Give a goodbye a moment to leave before the connection is closed.
    setTimeout(() => closePair(d, p), sayBye ? 250 : 0);
  }

  function connectionLost() {
    if (stage === 'chat') {
      setStage('lost');
      say('The connection was lost. The messages above are still on your screen only until you clear them.', true);
    } else if (stage === 'idle' || stage === 'lost') {
      /* nothing to do */
    } else if (stage === 'verify') {
      resetAll('The connection dropped before you verified it. Nothing was saved.', true);
    } else {
      resetAll('Could not connect. If one of you edited or mistyped a code, start again. If you are on different networks, both of you need "Across the internet" in Network settings, and very strict networks may still block a direct connection.', true);
    }
  }

  function goVerify() {
    try {
      const words = sasWords(pc.localDescription.sdp, pc.remoteDescription.sdp).join(' ');
      $('cSas').textContent = words;
      $('cSasSmall').textContent = words;
      setStage('verify');
      say('Connected. One last check before you can talk.');
    } catch (e) {
      resetAll('Could not verify the connection: ' + e.message, true);
    }
  }

  /* ---------- messages ---------- */
  function ttlLabel(s) { return s >= 3600 ? '1 hour' : s >= 300 ? '5 minutes' : s + ' seconds'; }

  function addMsg(who, text, ttl) {
    const log = $('cLog');
    const row = document.createElement('div');
    row.className = 'msg ' + who;
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = text;               // text only, never HTML
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (who === 'me' ? 'You' : 'Them') + (ttl ? ' - disappears in ' + ttlLabel(ttl) : '');
    row.append(body, meta);
    log.appendChild(row);
    while (log.childElementCount > MAX_NODES) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (ttl) {
      const t = setTimeout(() => { row.remove(); timers.delete(t); }, ttl * 1000);
      timers.add(t);
    }
  }

  function incoming(raw) {
    if (typeof raw !== 'string' || raw.length > 30000) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'bye') {
      resetAll('Your contact ended the session. The chat was cleared and nothing was saved.');
      return;
    }
    if (m.t !== 'msg' || typeof m.text !== 'string' || !m.text.length || m.text.length > MAX_TEXT) return;
    const ttl = TTLS.includes(m.ttl) ? m.ttl : 0;
    if (!verified) { if (queue.length < 100) queue.push({ text: m.text, ttl }); return; }
    addMsg('them', m.text, ttl);
  }

  function sendMsg() {
    if (stage !== 'chat' || !dc || dc.readyState !== 'open') return;
    const text = $('cInput').value.trim();
    if (!text) return;
    if (text.length > MAX_TEXT) return say('That message is too long (max ' + MAX_TEXT + ' characters).', true);
    const ttl = parseInt($('cTtl').value, 10);
    try {
      dc.send(JSON.stringify({ t: 'msg', text, ttl }));
    } catch (e) {
      return say('Could not send: ' + e.message, true);
    }
    addMsg('me', text, ttl);
    $('cInput').value = '';
  }

  /* ---------- buttons ---------- */
  function armHint() {
    const t = setTimeout(() => {
      timers.delete(t);
      if (stage === 'connecting') {
        say('Still connecting... If you are on different networks, both of you need "Across the internet" in Network settings. Strict work or mobile networks can block direct connections; try another network or a phone hotspot.');
      }
    }, HINT_MS);
    timers.add(t);
  }

  $('cStart').addEventListener('click', async () => {
    try {
      resetAll();
      const p = newPC();
      dc = p.createDataChannel('chat', { ordered: true });
      bindChannel(dc);
      setStage('starter');
      say('Creating your code... (a few seconds)');
      await p.setLocalDescription(await p.createOffer());
      await gather(p);
      if (p !== pc) return;
      $('cOfferOut').value = await encodeCode({ v: 1, t: 'offer', sdp: p.localDescription.sdp });
      say('Step 1: send the code above to your contact. Step 2: paste the reply they send back below.');
    } catch (e) {
      resetAll('Could not start: ' + e.message, true);
    }
  });

  $('cJoin').addEventListener('click', () => {
    resetAll();
    setStage('joiner');
    say('Paste the code your contact sent you.');
  });

  $('cMakeReply').addEventListener('click', async () => {
    try {
      const sdp = await decodeCode($('cOfferIn').value, 'offer');
      closePair(dc, pc);
      dc = null;
      pc = null;
      const p = newPC();
      say('Creating your reply... (a few seconds)');
      await p.setRemoteDescription({ type: 'offer', sdp });
      await p.setLocalDescription(await p.createAnswer());
      await gather(p);
      if (p !== pc) return;
      $('cAnswerOut').value = await encodeCode({ v: 1, t: 'answer', sdp: p.localDescription.sdp });
      say('Send the reply above back to your contact. The chat opens by itself once they paste it.');
      armHint();
    } catch (e) {
      const keep = $('cOfferIn').value;
      resetAll();
      setStage('joiner');
      $('cOfferIn').value = keep;
      say(e.message, true);
    }
  });

  $('cConnect').addEventListener('click', async () => {
    try {
      const sdp = await decodeCode($('cReplyIn').value, 'answer');
      if (!pc) throw new Error('The session was reset. Start again.');
      await pc.setRemoteDescription({ type: 'answer', sdp });
      setStage('connecting');
      say('Connecting...');
      armHint();
    } catch (e) {
      say(e.message, true);
    }
  });

  $('cMatch').addEventListener('click', () => {
    verified = true;
    setStage('chat');
    say('Verified. Nothing you say here is saved anywhere.');
    for (const m of queue) addMsg('them', m.text, m.ttl);
    queue = [];
    $('cInput').focus();
  });

  $('cNoMatch').addEventListener('click', () => {
    resetAll('The words did not match, so the session was dropped. Someone may be tampering with the connection. Do not continue; try again over a different channel.', true);
  });

  $('cSend').addEventListener('click', sendMsg);
  $('cInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });

  $('cEnd').addEventListener('click', () => {
    resetAll('Session ended. Everything was cleared and nothing was saved.', false, true);
  });
  $('cClearLost').addEventListener('click', () => resetAll('Cleared. Nothing was saved.'));
  for (const b of document.querySelectorAll('#tab-chat .cancel')) {
    b.addEventListener('click', () => resetAll('Cancelled. Nothing was saved.', false, true));
  }

  // Leaving the page counts as ending the session.
  window.addEventListener('pagehide', () => {
    const d = dc, p = pc;
    dc = null;
    pc = null;
    if (d && d.readyState === 'open') { try { d.send(JSON.stringify({ t: 'bye' })); } catch (e) { /* ignore */ } }
    closePair(d, p);
  });

  setStage('idle');
})();
