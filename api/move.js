/**
 * /api/move — submit one move.
 *
 * Flow (the "hybrid" model):
 *   1. structural link validation (pure logic, no network)
 *   2. verify the song exists via MusicBrainz (cached in Neon)
 *   3. best-effort Spotify lookup for preview + track URI
 *
 * Steps 1 and 2 gate acceptance. Step 3 is decorative — if Spotify is
 * down or the track isn't findable there, the move still succeeds; the
 * client just won't get preview audio for that song.
 */

const { validateMove, stem, rawTokens } = require('../lib/wordlink');
const { verifySong } = require('../lib/verify');
const { searchTrack } = require('../lib/spotify');
const { Client } = require('pg');

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

  // Verify existence via MusicBrainz (cached).
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
      // Group vote: accept anyway. Still try to find it on Spotify for media.
      const spotify = await searchTrack(next.title, next.artist);
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

  // MusicBrainz confirmed. Get Spotify data as a bonus (best-effort).
  // Use the canonical names — Spotify's search does better with clean strings.
  const spotify = await searchTrack(
    verification.canonicalTitle || next.title,
    verification.canonicalArtist || next.artist,
  );

  return res.status(200).json({
    accepted: true,
    canonicalTitle: verification.canonicalTitle,
    canonicalArtist: verification.canonicalArtist,
    linkStem: isOpening ? null : stem(rawTokens(linkWord)[0] || ''),
    spotify,
  });
};
