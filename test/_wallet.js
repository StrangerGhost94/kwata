// For tests that pay from a rider's wallet: every wallet payment needs a wallet pass, which comes
// from the rider's Wallet PIN. Creates the PIN the first time (new accounts need no code).
const PIN = '4827';
module.exports = function walletPass(BASE, token) {
  const post = (p, b) => fetch(BASE + '/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(b) }).then((r) => r.json());
  return post('/wallet/unlock/pin', { pin: PIN }).then((u) => u.pass || post('/wallet/pin', { pin: PIN }).then((s) => {
    if (!s.pass) throw new Error('could not get a wallet pass: ' + JSON.stringify(s));
    return s.pass;
  }));
};
