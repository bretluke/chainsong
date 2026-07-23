/**
 * spotify.js — Spotify API helpers.
 *
 * Two paths in one file:
 *   - Client Credentials (getClientCredentialsToken) for public search
 *     that doesn't need a user — album art, track URI, popularity ranking.
 *   - User OAuth (exchangeCodeForToken, refreshUserToken, getUserProfile)
 *     for actions on behalf of a signed-in user (Web Playback SDK's
 *     OAuth callback, playlist creation via /me/playlists).
 */

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI;

// ---------------------------------------------------------------------------
// Client Credentials token — cached in-process to skip a network round-trip
// per request. Spotify's app tokens last an hour; we refresh 60s before.
// ---------------------------------------------------------------------------

let cachedToken       = null;
let cachedTokenExpiry = 0;

async function getClientCredentialsToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res  = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token: ${res.status}`);

  const data          = await res.json();
  cachedToken         = data.access_token;
  cachedTokenExpiry   = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// ---------------------------------------------------------------------------
// Search for the CANONICAL version of a track.
//
// Spotify's search ranking sometimes surfaces instrumentals, karaoke, or
// tribute versions at the top when they share the same title as a hit —
// the karaoke/instrumental catalogs are surprisingly comprehensive. So:
//
//   1. Ask for 10 candidates instead of 1.
//   2. Drop any obvious non-canonical cuts unless the user's own query
//      asked for that cut (they typed "Yesterday Live" -> keep live).
//   3. Rank remaining candidates by Spotify's `popularity` score (0-100).
//      Popularity tracks recent plays, so the version people actually
//      know rises to the top.
//   4. If our filter emptied the list (nothing but instrumentals came
//      back for this title), fall back to the raw list ranked by
//      popularity, so we still return SOMETHING.
// ---------------------------------------------------------------------------

const ALT_CUT_RE = /\b(instrumental|karaoke|acoustic|remix|cover|tribute|live|demo)\b/i;

async function searchTrack(title, artist) {
  const token = await getClientCredentialsToken();
  const q     = `track:"${title.replace(/"/g, '')}" artist:"${artist.replace(/"/g, '')}"`;
  const url   = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=10`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;

  const data  = await res.json();
  const items = data.tracks?.items || [];
  if (!items.length) return null;

  const userWantsAlt = ALT_CUT_RE.test(title);
  const filtered     = userWantsAlt ? items : items.filter(t => !ALT_CUT_RE.test(t.name));
  const pool         = filtered.length ? filtered : items;
  const best         = pool.slice().sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0];

  return {
    uri:         best.uri,
    name:        best.name,
    artist:      best.artists.map(a => a.name).join(', '),
    albumArt:    best.album?.images?.[0]?.url,
    previewUrl:  best.preview_url,
    externalUrl: best.external_urls?.spotify,
  };
}

// ---------------------------------------------------------------------------
// User OAuth helpers — used by api/spotify-*.js endpoints.
// ---------------------------------------------------------------------------

async function exchangeCodeForToken(code) {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res  = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token exchange: ${res.status}`);
  return await res.json();
}

async function refreshUserToken(refreshToken) {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res  = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) throw new Error(`refresh: ${res.status}`);
  return await res.json();
}

async function getUserProfile(accessToken) {
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`profile: ${res.status}`);
  return await res.json();
}

module.exports = {
  getClientCredentialsToken,
  searchTrack,
  exchangeCodeForToken,
  refreshUserToken,
  getUserProfile,
};
