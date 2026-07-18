/**
 * /api/spotify-playlist — save the current chain as a private Spotify playlist.
 *
 * POST { name, trackUris: ["spotify:track:xxx", ...] }
 * Returns { url } — the Spotify web link to the created playlist.
 *
 * Requires the user to be logged in. Refreshes their token if needed.
 */

const { getMe, refreshUserToken, createPlaylistWithTracks } = require('../lib/spotify');
const { parse, serialize, setCookies, NAMES } = require('../lib/cookies');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { name, trackUris } = req.body || {};
  if (!name || !Array.isArray(trackUris)) {
    return res.status(400).json({ error: 'name and trackUris required' });
  }

  const cookies = parse(req.headers.cookie);
  let accessToken = cookies[NAMES.ACCESS];
  const refreshToken = cookies[NAMES.REFRESH];

  if (!accessToken && refreshToken) {
    try {
      const t = await refreshUserToken(refreshToken);
      accessToken = t.accessToken;
      const expiresAt = Math.floor(Date.now() / 1000) + t.expiresIn - 60;
      setCookies(res, [
        serialize(NAMES.ACCESS, t.accessToken, { maxAge: t.expiresIn }),
        serialize(NAMES.REFRESH, t.refreshToken, { maxAge: 60 * 60 * 24 * 30 }),
        serialize(NAMES.EXPIRES, String(expiresAt), { maxAge: 60 * 60 * 24 * 30, httpOnly: false }),
      ]);
    } catch (e) {
      return res.status(401).json({ error: 'not_logged_in' });
    }
  }
  if (!accessToken) return res.status(401).json({ error: 'not_logged_in' });

  const me = await getMe(accessToken);
  if (!me) return res.status(401).json({ error: 'not_logged_in' });

  try {
    const playlist = await createPlaylistWithTracks(
      accessToken,
      me.id,
      name,
      'Created by Chainsong — the word-linking song game.',
      trackUris.filter(Boolean),
    );
    res.status(200).json({ url: playlist.url });
  } catch (e) {
    console.error('playlist create failed', e);
    res.status(500).json({ error: 'playlist_failed' });
  }
};
