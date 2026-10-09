(() => {
  'use strict';
  const { $, status, copyText, vendorOk } = window.TK;
  if (!vendorOk) return;
  const CP = window.CP;

  // Official BIP84 test vector (account 0, first receive address).
  const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const TEST_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

  const normalise = s => s.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');

  function render(list) {
    const ul = $('wList');
    ul.textContent = '';
    for (const item of list) {
      const li = document.createElement('li');
      const path = document.createElement('span');
      path.className = 'path';
      path.textContent = item.path;
      const code = document.createElement('code');
      code.textContent = item.address;
      const copy = document.createElement('button');
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => {
        copy.textContent = (await copyText(item.address)) ? 'Copied' : 'Select manually';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
      });
      const qrBtn = document.createElement('button');
      qrBtn.textContent = 'QR';
      const qr = document.createElement('div');
      qr.className = 'qr';
      qr.hidden = true;
      qrBtn.addEventListener('click', () => {
        if (qr.hidden && !qr.firstChild) qr.innerHTML = CP.qrSvg(item.address);
        qr.hidden = !qr.hidden;
      });
      li.append(path, code, copy, qrBtn, qr);
      ul.appendChild(li);
    }
    $('wPrint').hidden = list.length === 0;
  }

  async function derive() {
    const m = normalise($('wMnemonic').value);
    $('wMnemonic').value = m;
    if (!m) { status('wStatus', 'Generate a phrase first, or paste one to restore.', true); return; }
    if (!CP.wallet.validate(m)) {
      status('wStatus', 'That phrase is not valid (a word is misspelled, missing, or the checksum fails).', true);
      render([]);
      return;
    }
    try {
      const list = await CP.wallet.deriveAddresses(m, $('wPass').value, parseInt($('wCount').value, 10));
      render(list);
      status('wStatus', 'Phrase is valid. Showing ' + list.length + ' receiving address' + (list.length > 1 ? 'es' : '') + '.');
    } catch (e) {
      status('wStatus', 'Could not derive addresses: ' + e.message, true);
    }
  }

  $('wGen').addEventListener('click', async () => {
    $('wMnemonic').value = CP.wallet.generate(parseInt($('wWords').value, 10));
    $('wPass').value = '';
    await derive();
    status('wStatus', 'New phrase generated. Write it down on paper now. ' + $('wStatus').textContent);
  });
  $('wDerive').addEventListener('click', derive);

  $('wTest').addEventListener('click', async () => {
    try {
      const [first] = await CP.wallet.deriveAddresses(TEST_MNEMONIC, '', 1);
      if (first.address === TEST_ADDRESS) {
        status('wStatus', 'Self-test PASSED: the standard BIP84 test phrase gives ' + TEST_ADDRESS + ' as expected.');
      } else {
        status('wStatus', 'Self-test FAILED. Got ' + first.address + '. Do not use this copy for real funds.', true);
      }
    } catch (e) {
      status('wStatus', 'Self-test FAILED: ' + e.message, true);
    }
  });

  $('wClear').addEventListener('click', () => {
    $('wMnemonic').value = '';
    $('wPass').value = '';
    render([]);
    status('wStatus', 'Screen cleared. (Copies you made elsewhere, such as the clipboard, are not cleared.)');
  });

  $('wPrint').addEventListener('click', () => window.print());
})();
