/**
 * cookies.js — small helpers for reading and setting httpOnly cookies.
 *
 * Vercel serverless functions get raw req/res; we don't have Express
 * middleware, so we do this by hand. Kept in one place so all endpoints
 * agree on the cookie names and flags.
 */

// Cookie names — kept short to save header space (Spotify tokens are big).
const NAMES = {
  ACCESS:  'sl_at',
  REFRESH: 'sl_rt',
  EXPIRES: 'sl_exp',
  STATE:   'sl_state', // OAuth CSRF-protection nonce
};

function parse(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const p of cookieHeader.split(';')) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

function serialize(name, value, { maxAge, httpOnly = true, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${path}`);
  parts.push('SameSite=Lax');
  parts.push('Secure');                      // Vercel is always https
  if (httpOnly) parts.push('HttpOnly');
  if (typeof maxAge === 'number') parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

function setCookies(res, cookies) {
  const existing = res.getHeader('Set-Cookie') || [];
  const arr = Array.isArray(existing) ? existing : [existing];
  res.setHeader('Set-Cookie', [...arr, ...cookies]);
}

function clearAuthCookies(res) {
  const kill = (n) => serialize(n, '', { maxAge: 0 });
  setCookies(res, [kill(NAMES.ACCESS), kill(NAMES.REFRESH), kill(NAMES.EXPIRES)]);
}

module.exports = { NAMES, parse, serialize, setCookies, clearAuthCookies };
