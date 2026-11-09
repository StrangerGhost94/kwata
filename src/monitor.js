// Crash and error reporting. Set SENTRY_DSN in Railway → Variables (sentry.io → Project settings →
// Client Keys) to send server errors, and errors from riders' and drivers' phones, to Sentry.
// Without it, errors are only written to the server log, as before.
let Sentry = null;
function init() {
  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn || Sentry) return;
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development',
      release: 'flytte@' + require('../package.json').version + (process.env.RAILWAY_GIT_COMMIT_SHA ? '+' + process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7) : ''),
      tracesSampleRate: 0,
      sendDefaultPii: false,   // no IP addresses, cookies or request bodies: riders' data stays here
      beforeSend(event) {
        if (event.request) { delete event.request.cookies; delete event.request.data; if (event.request.headers) { delete event.request.headers.authorization; delete event.request.headers.cookie; } }
        return event;
      },
    });
  } catch (e) { Sentry = null; console.error('Sentry could not start:', e.message); }
}
const on = () => !!Sentry;

function captureServer(err, req) {
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    if (req) { scope.setTag('route', `${req.method} ${req.route ? req.baseUrl + req.route.path : req.path}`); if (req.user) scope.setUser({ id: String(req.user.id) }); }
    Sentry.captureException(err);
  });
}

// An error reported by the app on a phone (window.onerror, failed promises).
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
function captureClient(body, user) {
  const r = body || {};
  const message = clip(r.message, 300) || 'Unknown error';
  const where = { app: clip(r.app, 20), version: clip(r.version, 40), platform: clip(r.platform, 20), page: clip(r.page, 120) };
  console.error('client error', JSON.stringify({ ...where, message, source: clip(r.source, 160), line: Number(r.line) || undefined, user: user ? user.id : undefined }));
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    scope.setTag('side', 'client');
    for (const [k, v] of Object.entries(where)) if (v) scope.setTag(k, v);
    if (user) scope.setUser({ id: String(user.id) });
    const e = new Error(message);
    e.name = clip(r.name, 60) || 'ClientError';
    if (r.stack) e.stack = clip(r.stack, 4000);
    Sentry.captureException(e);
  });
}

module.exports = { init, on, captureServer, captureClient };
