/**
 * /api/move — submit one move.
 *
 * Flow:
 *   1. Structural link validation (pure logic, no network).
 *   2. Verify the song exists via MusicBrainz (cached in Neon).
 *   3. Search Spotify + iTunes in parallel for media (album art, preview).
 *   4. Cross-check: if Spotify's top result has a title/artist that doesn't
 *      match what the user typed, treat it as a typo and reject. MusicBrainz
 *      indexes plenty of bootlegs and its fuzzy search will accept things
 *      like "Rock With Me" when the user meant "Rock With You"; Spotify's
 *      catalog is curated enough to catch that.
 */

const { validateMove, stem, rawTokens } = require('../lib/wordlink');
const { verifySong } = require('../lib/verify');
const { searchTrack } = require('../lib/spotify');
const { searchItunesPreview } = require('../lib/itunes');
const { Client } = require('pg');

// Words we treat as optional when matching titles. Deliberately narrow — we
// want "me" vs "you" to count as a mismatch, but "The Power of Love" should
// still match "Power of Love".
const TITLE_OPTIONAL = new Set(['a', 'an', 'the', 'of', 'and', 'to']);

function titleMatches(userTitle, canonicalTitle) {
  const userWords  = rawTokens(userTitle).filter(w => !TITLE_OPTIONAL.has(w));
  const canonWords = new Set(rawTokens(canonicalTitle).filter(w => !TITLE_OPTIONAL.has(w)));
  if (!userWords.length) return true;
  return userWords.every(w => canonWords.has(w));
}

function artistMatches(userArtist, canonicalArtist) {
  const userWords  = rawTokens(userArtist).filter(w => !TITLE_OPTIONAL.has(w));
  const canonWords = new Set(rawTokens(canonicalArtist).filter(w => !TITLE_OPTIONAL.has(w)));
  if (!userWords.length) return true;
  // Artists get more slack — "featuring X" additions are common on Spotify.
  const hits = userWords.filter(w => canonWords.has(w)).length;
  return hits >= userWords.length * 0.6;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { prev, next, linkWord, forbiddenStem, allowOverride } = req.body || {};

  if (!next?.title || !next?.artist || !linkWord) {
    return res.status(400).json({ error: 'next.title, next.artist, linkWord required' });
  }

  const isOpening = !prev?.title;

  if (!isOpening) {
    const v = validateMove(prev, next, linkWord, forbiddenStem || null);
    if (!v.ok) return res.status(200).json({ accepted: false, reason: v.reason });
  }

  // Verify existence via MusicBrainz (cached in Neon).
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  let verification;
  try {
    await db.connect();
    verification = await verifySong(db, next.title, next.artist);
  } catch (e) {
    verification = { found: false, error: 'DB_OR_NETWORK' };
  } finally {
    try { await db.end(); } catch (_) {}
  }

  if (!verification.found) {
    if (allowOverride) {
      // Group vote path (currently unused by the client, but kept in case
      // we bring back a manual-override flow later).
      const [spotify, itunesPreview] = await Promise.all([
        searchTrack(next.title, next.artist),
        searchItunesPreview(next.title, next.artist),
      ]);
      if (spotify) spotify.previewUrl = itunesPreview || spotify.previewUrl;
      return res.status(200).json({
        accepted: true,
        override: true,
        linkStem: isOpening ? null : stem(rawTokens(linkWord)[0] || ''),
        canonicalTitle: next.title,
        canonicalArtist: next.artist,
        spotify,
      });
    }
    return res.status(200).json({
      accepted: false,
      reason: verification.error ? 'VERIFY_UNAVAILABLE' : 'SONG_NOT_FOUND',
      needsOverride: true,
    });
  }

  // MusicBrainz says it exists. Now enrich with Spotify + iTunes.
  const [spotify, itunesPreview] = await Promise.all([
    searchTrack(
      verification.canonicalTitle || next.title,
      verification.canonicalArtist || next.artist,
    ),
    searchItunesPreview(
      verification.canonicalTitle || next.title,
      verification.canonicalArtist || next.artist,
    ),
  ]);
  if (spotify) spotify.previewUrl = itunesPreview || spotify.previewUrl;

  // The typo guard. If Spotify returned nothing at all, we defer to MB and
  // still accept — some real but obscure tracks aren't on Spotify. But if
  // Spotify DID return a result and its title or artist don't line up with
  // what the user typed, that's the fingerprint of a typo (MB fuzzy-hit an
  // obscure bootleg, Spotify's top result is actually a different song).
  if (spotify &&
      (!titleMatches(next.title, spotify.name) ||
       !artistMatches(next.artist, spotify.artist))) {
    return res.status(200).json({
      accepted: false,
      reason: 'SONG_NOT_FOUND',
    });
  }

  return res.status(200).json({
    accepted: true,
    canonicalTitle: verification.canonicalTitle,
    canonicalArtist: verification.canonicalArtist,
    linkStem: isOpening ? null : stem(rawTokens(linkWord)[0] || ''),
    spotify,
  });
};
