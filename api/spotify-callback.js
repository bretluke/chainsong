/**
 * /api/spotify-callback — Spotify sends the user here after they approve.
 *
 * We:
 *   1. verify the state cookie matches (CSRF check)
 *   2. exchange the auth code for access + refresh tokens
 *   3. set httpOnly cookies with the tokens
 *   4. redirect back to /
 *
 * Errors redirect to /?spotify=error rather than showing raw stack traces —
 * the client reads that query param and shows a friendly message.
 */

const { exchangeCodeForTokens } = require('../lib/spotify');
const { parse, serialize, setCookies, NAMES } = require('../lib/cookies');

module.exports = async function handler(req, res) {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const cookies = parse(req.headers.cookie);
  const savedState = cookies[NAMES.STATE];

  const bounce = (kind) => {
    res.writeHead(302, { Location: `/?spotify=${kind}` });
    res.end();
  };

  if (errorParam)          return bounce('denied');
  if (!code)               return bounce('no_code');
  if (!state || state !== savedState) return bounce('bad_state');

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const expiresAt = Math.floor(Date.now() / 1000) + tokens.expiresIn - 60;
    setCookies(res, [
      serialize(NAMES.ACCESS,  tokens.accessToken,  { maxAge: tokens.expiresIn }),
      // Refresh token: give it 30 days. Spotify refresh tokens don't
      // technically expire, but browsers cap cookie lifetime anyway.
      serialize(NAMES.REFRESH, tokens.refreshToken, { maxAge: 60 * 60 * 24 * 30 }),
      serialize(NAMES.EXPIRES, String(expiresAt),   { maxAge: 60 * 60 * 24 * 30, httpOnly: false }),
      serialize(NAMES.STATE,   '',                  { maxAge: 0 }),
    ]);
    res.writeHead(302, { Location: '/?spotify=ok' });
    res.end();
  } catch (e) {
    console.error('spotify callback error', e);
    bounce('exchange_failed');
  }
};
