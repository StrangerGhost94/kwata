// flytte.co/delete-account: delete a Flytte account without the app (Google Play requires this page).
// Confirm the number with a one-time code, then the same deletion as Account → Settings runs.
(function () {
  const $ = (id) => document.getElementById(id);
  const msg = (t, ok) => { $('msg').textContent = t || ''; $('msg').className = 'fm-msg' + (ok ? ' ok' : ''); };
  const show = (id) => ['s-phone', 's-code', 's-confirm', 's-done'].forEach((s) => { $(s).hidden = s !== id; });
  let phone = '', token = '', channel = 'sms';
  async function api(path, body, auth) {
    const r = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body || {}) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(out.error || 'Something went wrong. Try again.'); e.status = r.status; e.code = out.code; throw e; }
    return out;
  }
  fetch('/api/config').then((r) => r.json()).then((c) => { const ch = c.codeChannels || []; channel = ch.includes('sms') ? 'sms' : ch[0] || 'sms'; }).catch(() => {});

  async function busy(btn, fn) { btn.disabled = true; msg(''); try { await fn(); } catch (e) { msg(e.message); } finally { btn.disabled = false; } }

  $('del').addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy($('send'), async () => {
      phone = $('phone').value.trim();
      if (phone.replace(/\D/g, '').length < 9) throw new Error('Enter the phone number on your Flytte account.');
      const r = await api('/auth/otp/send', { phone, channel });
      if (!r.exists) throw new Error('No Flytte account uses this number. Check it and try again.');
      if (r.role === 'admin') throw new Error('Team accounts are removed by a Flytte administrator.');
      $('to').textContent = phone;
      show('s-code'); $('code').focus();
      if (r.demoCode) msg(`Test mode: your code is ${r.demoCode}`, true);
    });
  });
  $('code').addEventListener('input', () => { if ($('code').value.replace(/\D/g, '').length === 6) $('check').click(); });
  $('check').addEventListener('click', () => busy($('check'), async () => {
    const code = $('code').value.replace(/\D/g, '');
    if (code.length !== 6) throw new Error('Enter the 6-digit code.');
    const r = await api('/auth/otp/verify', { phone, code });
    if (!r.token) throw new Error('No Flytte account uses this number.');
    token = r.token;
    $('who').textContent = `Delete the ${r.user.role === 'driver' ? 'Flytte Driver' : 'Flytte'} account for ${r.user.name} (${r.user.phone})? This can’t be undone.`;
    show('s-confirm'); $('go').focus();
  }));
  $('go').addEventListener('click', () => busy($('go'), async () => {
    if (!$('walletRow').hidden && !$('forfeit').checked) throw new Error('Tick the box to confirm you’ll lose the money in your wallet.');
    try { await api('/me/delete', { forfeit: !$('walletRow').hidden && $('forfeit').checked }, token); }
    catch (e) {
      if (e.code === 'WALLET') { $('walletText').textContent = e.message + ' Tick to delete anyway.'; $('walletRow').hidden = false; throw new Error('Your wallet still has money in it.'); }
      throw e;
    }
    token = ''; show('s-done'); msg('');
  }));
})();
