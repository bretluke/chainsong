/**
 * verify.js — song existence verification via MusicBrainz, cached in Postgres.
 *
 * Design notes:
 *  - MusicBrainz is free, keyless, legal to use, and metadata-only. It does
 *    NOT provide lyrics or audio, which is exactly what we want: we only need
 *    to confirm "a recording with ~this title by ~this artist exists".
 *  - MusicBrainz asks for a descriptive User-Agent and rate-limits to ~1
 *    request/second. We cache every lookup in Postgres (Neon) keyed by a
 *    normalized title+artist so repeat verifications are instant and free,
 *    and so gameplay never blocks on the rate limit twice for the same song.
 *  - This runs only AFTER the player commits their full answer (the "hybrid"
 *    model the user chose). It is never called while the user is typing, so
 *    it can never behave like an autocomplete.
 */

const { rawTokens } = require('./wordlink');

const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'SongLinkGame/1.0 ( https://songlink.app )';

function cacheKey(title, artist) {
  return rawTokens(title).join(' ') + '::' + rawTokens(artist).join(' ');
}

/**
 * Look the song up in MusicBrainz. Returns:
 *   { found: true, canonicalTitle, canonicalArtist, score }
 *   { found: false }
 * `score` is MB's match confidence (0-100); we treat >= 80 as a confident hit.
 */
async function queryMusicBrainz(title, artist) {
  const q = `recording:"${title.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`;
  const url = `${MB_BASE}/recording?query=${encodeURIComponent(q)}&fmt=json&limit=3`;

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    // Network/ratelimit failure: surface a distinct state so the caller can
    // fall back to the group-challenge override rather than failing the move.
    return { found: false, error: `MB_HTTP_${res.status}` };
  }
  const data = await res.json();
  const rec = (data.recordings || [])[0];
  if (!rec || (rec.score ?? 0) < 80) return { found: false };

  const canonicalArtist =
    (rec['artist-credit'] || []).map((a) => a.name).join(' ') || artist;
  return {
    found: true,
    canonicalTitle: rec.title || title,
    canonicalArtist,
    score: rec.score,
  };
}

/**
 * Cached verify. `db` is a node-postgres-compatible client (Neon).
 * Falls back gracefully: if the cache table is missing or MB is down, the
 * caller still gets a definitive {found:false,error} and can offer the
 * manual group-override path.
 */
async function verifySong(db, title, artist) {
  const key = cacheKey(title, artist);

  try {
    const hit = await db.query(
      'SELECT found, canonical_title, canonical_artist FROM song_cache WHERE cache_key = $1',
      [key]
    );
    if (hit.rows.length) {
      const r = hit.rows[0];
      return {
        found: r.found,
        canonicalTitle: r.canonical_title,
        canonicalArtist: r.canonical_artist,
        cached: true,
      };
    }
  } catch (e) {
    // cache miss path also covers "table not created yet" during first deploy
  }

  const result = await queryMusicBrainz(title, artist);
  if (result.error) return result; // don't cache transient failures

  try {
    await db.query(
      `INSERT INTO song_cache (cache_key, found, canonical_title, canonical_artist)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (cache_key) DO NOTHING`,
      [key, result.found, result.canonicalTitle || null, result.canonicalArtist || null]
    );
  } catch (e) {
    /* cache write best-effort */
  }
  return { ...result, cached: false };
}

module.exports = { verifySong, cacheKey, queryMusicBrainz };
