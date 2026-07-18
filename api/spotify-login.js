/**
 * /api/spotify-login — start the Spotify OAuth flow.
 *
 * Redirects the user to Spotify with:
 *  - the scopes we need (user profile + playlist create + playback control)
 *  - a random state string (also set as a cookie) to prevent CSRF
 *
 * When Spotify sends the user back, our /api/spotify-callback checks the
 * state cookie matches the query param before exchanging the code.
 */

const crypto = require('crypto');
const { serialize, setCookies, NAMES } = require('../lib/cookies');

// Scopes:
//  user-read-private       — read display name + product tier (free/premium)
//  user-read-email         — makes /me include email; harmless, sometimes needed
//  playlist-modify-private — create the game-end playlist
//  streaming, user-modify-playback-state, user-read-playback-state
//                          — required for the Web Playback SDK (Premium only)
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-modify-private',
  'streaming',
  'playlist-modify-public',			
  'user-modify-playback-state',
  'user-read-playback-state',
].join(' ');

module.exports = function handler(req, res) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(500).send('Spotify env vars not configured');
  }

  const state = crypto.randomBytes(16).toString('hex');
  setCookies(res, [
    serialize(NAMES.STATE, state, { maxAge: 600 }), // 10 min to complete login
  ]);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
    show_dialog: 'false',
  });
  res.writeHead(302, { Location: `https://accounts.spotify.com/authorize?${params}` });
  res.end();
};
