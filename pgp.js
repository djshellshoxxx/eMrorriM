(() => {
  'use strict';
  const { $, status, vendorOk } = window.TK;
  if (!vendorOk) return;
  const pgp = window.CP.openpgp;

  const nice = e => (e && e.message ? e.message : String(e));

  // Read a private key and unlock it if a passphrase is given.
  async function loadPrivate(armored, pass) {
    let key = await pgp.readPrivateKey({ armoredKey: armored.trim() });
    if (!key.isDecrypted()) {
      if (!pass) throw new Error('This private key needs its passphrase.');
      key = await pgp.decryptKey({ privateKey: key, passphrase: pass });
    }
    return key;
  }

  $('gGo').addEventListener('click', async () => {
    const name = $('gName').value.trim();
    const email = $('gEmail').value.trim();
    const pass = $('gPass').value;
    if (!name) return status('gStatus', 'Enter a name.', true);
    if (!pass) return status('gStatus', 'Choose a passphrase to protect the private key.', true);
    try {
      status('gStatus', 'Generating...');
      const userID = email ? { name, email } : { name };
      const { privateKey, publicKey } = await pgp.generateKey({
        type: 'ecc', curve: 'curve25519', userIDs: [userID], passphrase: pass, format: 'armored'
      });
      const pub = await pgp.readKey({ armoredKey: publicKey });
      $('gPub').value = publicKey;
      $('gPriv').value = privateKey;
      status('gStatus', 'Key pair created. Fingerprint: ' + pub.getFingerprint().toUpperCase().replace(/(.{4})/g, '$1 ').trim());
    } catch (e) { status('gStatus', 'Failed: ' + nice(e), true); }
  });

  $('eGo').addEventListener('click', async () => {
    $('eOut').value = '';
    const msg = $('eMsg').value;
    if (!$('eKeys').value.trim()) return status('eStatus', 'Paste at least one public key.', true);
    if (!msg) return status('eStatus', 'Type a message.', true);
    try {
      const keys = await pgp.readKeys({ armoredKeys: $('eKeys').value.trim() });
      const out = await pgp.encrypt({
        message: await pgp.createMessage({ text: msg }),
        encryptionKeys: keys,
        format: 'armored'
      });
      $('eOut').value = out;
      status('eStatus', 'Encrypted for ' + keys.length + ' recipient' + (keys.length > 1 ? 's' : '') + '.');
    } catch (e) { status('eStatus', 'Failed: ' + nice(e), true); }
  });

  $('dGo').addEventListener('click', async () => {
    $('dOut').value = '';
    try {
      const key = await loadPrivate($('dKey').value, $('dPass').value);
      const { data } = await pgp.decrypt({
        message: await pgp.readMessage({ armoredMessage: $('dMsg').value.trim() }),
        decryptionKeys: key
      });
      $('dOut').value = data;
      status('dStatus', 'Decrypted.');
    } catch (e) { status('dStatus', 'Failed: ' + nice(e), true); }
  });

  $('sgGo').addEventListener('click', async () => {
    $('sgOut').value = '';
    if (!$('sgMsg').value) return status('sgStatus', 'Type the text to sign.', true);
    try {
      const key = await loadPrivate($('sgKey').value, $('sgPass').value);
      $('sgOut').value = await pgp.sign({
        message: await pgp.createCleartextMessage({ text: $('sgMsg').value }),
        signingKeys: key,
        format: 'armored'
      });
      status('sgStatus', 'Signed.');
    } catch (e) { status('sgStatus', 'Failed: ' + nice(e), true); }
  });

  $('vGo').addEventListener('click', async () => {
    try {
      const pubKey = await pgp.readKey({ armoredKey: $('vKey').value.trim() });
      const message = await pgp.readCleartextMessage({ cleartextMessage: $('vMsg').value.trim() });
      const { signatures } = await pgp.verify({ message, verificationKeys: pubKey });
      await signatures[0].verified; // throws if the signature is bad
      status('vStatus', 'VALID signature from key ' + pubKey.getFingerprint().toUpperCase().slice(-16) + '.');
    } catch (e) { status('vStatus', 'NOT valid: ' + nice(e), true); }
  });
})();
