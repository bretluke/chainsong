/**
 * /api/spotify-me — return the logged-in user, refreshing tokens as needed.
 *
 * Response (logged in):
 *   { loggedIn: true, id, displayName, product, accessToken }
 * Response (not logged in / any error):
 *   { loggedIn: false }
 *
 * `accessToken` is included because the Spotify Web Playback SDK runs
 * client-side and needs the raw token to initialize. This is the only
 * place we hand the token to JavaScript — everywhere else it stays
 * httpOnly. The token has a 1-hour lifetime; the SDK will call this
 * endpoint again when it needs a fresh one.
 */

const { getMe, refreshUserToken } = require('../lib/spotify');
const { parse, serialize, setCookies, NAMES } = require('../lib/cookies');

module.exports = async function handler(req, res) {
  const cookies = parse(req.headers.cookie);
  let accessToken = cookies[NAMES.ACCESS];
  const refreshToken = cookies[NAMES.REFRESH];

  if (!accessToken && !refreshToken) {
    return res.status(200).json({ loggedIn: false });
  }

  // If we have a refresh token but no access token (expired), refresh first.
  if (!accessToken && refreshToken) {
    try {
      const t = await refreshUserToken(refreshToken);
      accessToken = t.accessToken;
      const expiresAt = Math.floor(Date.now() / 1000) + t.expiresIn - 60;
      setCookies(res, [
        serialize(NAMES.ACCESS,  t.accessToken,  { maxAge: t.expiresIn }),
        serialize(NAMES.REFRESH, t.refreshToken, { maxAge: 60 * 60 * 24 * 30 }),
        serialize(NAMES.EXPIRES, String(expiresAt), { maxAge: 60 * 60 * 24 * 30, httpOnly: false }),
      ]);
    } catch (e) {
      return res.status(200).json({ loggedIn: false });
    }
  }

  const me = await getMe(accessToken);
  if (!me) return res.status(200).json({ loggedIn: false });

  return res.status(200).json({
    loggedIn: true,
    id: me.id,
    displayName: me.display_name || me.id,
    product: me.product,           // "premium" | "free" | "open"
    accessToken,                   // for Web Playback SDK client-side init
  });
};
