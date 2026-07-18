/**
 * spotify.js — Spotify API helpers used by all /api/spotify-* endpoints.
 *
 * Two auth flows are used:
 *
 *   Client Credentials (server-only, app-level)
 *     - No user login. Used for /search and to fetch preview URLs.
 *     - Token cached in-process; Vercel reuses warm lambdas so most calls
 *       hit the cache. On cold start we fetch a fresh token (~200ms).
 *
 *   Authorization Code (user-level)
 *     - The user logs in and grants scopes we ask for.
 *     - Tokens live in httpOnly cookies (see lib/cookies.js).
 *     - Refresh handled automatically by withUserToken().
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE  = 'https://api.spotify.com/v1';

// In-lambda cache for the app-level token. { token, expiresAt (ms epoch) }
let appTokenCache = null;

/** Base64-encoded "client_id:client_secret" for Basic auth on token calls. */
function basicAuth() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

/**
 * Get an app-level access token via Client Credentials. Cached.
 * Returns the token string, or null if Spotify env vars aren't configured
 * (so callers can degrade gracefully instead of crashing the move endpoint).
 */
async function getAppToken() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    return null;
  }
  if (appTokenCache && appTokenCache.expiresAt > Date.now() + 30_000) {
    return appTokenCache.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) return null;
  const data = await res.json();
  appTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return appTokenCache.token;
}

/**
 * Search Spotify for a track matching title + artist. Returns the best
 * match's { id, uri, name, artist, previewUrl, albumArt } or null.
 * Never throws — Spotify is a nice-to-have, not required for the game.
 */
async function searchTrack(title, artist) {
  const token = await getAppToken();
  if (!token) return null;
  const q = `track:${title} artist:${artist}`;
  const url = `${API_BASE}/search?type=track&limit=1&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const t = data.tracks?.items?.[0];
    if (!t) return null;
    return {
      id: t.id,
      uri: t.uri,                       // spotify:track:xxxxx — for Web Playback SDK
      name: t.name,
      artist: (t.artists || []).map((a) => a.name).join(', '),
      previewUrl: t.preview_url,        // may be null; not all tracks have one
      albumArt: t.album?.images?.[0]?.url || null,
      externalUrl: t.external_urls?.spotify || null,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Exchange an authorization code for user tokens (login callback).
 * Returns { accessToken, refreshToken, expiresIn } or throws.
 */
async function exchangeCodeForTokens(code, redirectUri) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`token exchange failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Refresh a user's access token using their refresh token.
 * Returns { accessToken, expiresIn, refreshToken? } — Spotify sometimes
 * returns a new refresh token, sometimes not.
 */
async function refreshUserToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token || refreshToken,
  };
}

/** Fetch the logged-in user's profile: { id, display_name, product } */
async function getMe(accessToken) {
  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Create a playlist for the given user and add tracks.
 * `trackUris` should be an array of "spotify:track:xxx" strings.
 * Returns { id, url } for the created playlist.
 */
async function createPlaylistWithTracks(accessToken, userId, name, description, trackUris) {
  const createRes = await fetch(`${API_BASE}/users/${userId}/playlists`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, description, public: false }),
  });
  if (!createRes.ok) throw new Error(`create playlist failed: ${createRes.status}`);
  const playlist = await createRes.json();

  // Spotify accepts up to 100 URIs per add; our games won't come close.
  if (trackUris.length) {
    const addRes = await fetch(`${API_BASE}/playlists/${playlist.id}/tracks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: trackUris }),
    });
    if (!addRes.ok) throw new Error(`add tracks failed: ${addRes.status}`);
  }
  return { id: playlist.id, url: playlist.external_urls?.spotify };
}

module.exports = {
  getAppToken,
  searchTrack,
  exchangeCodeForTokens,
  refreshUserToken,
  getMe,
  createPlaylistWithTracks,
};
