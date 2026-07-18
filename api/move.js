/**
 * /api/move — submit one move (Vercel serverless function).
 *
 * Flow (the "hybrid" model):
 *   1. client sends prev song, new song, chosen link word, forbidden stem
 *   2. validate the link with pure logic (wordlink.validateMove)
 *   3. ONLY IF the link is structurally valid, verify the new song exists
 *      (verify.verifySong against MusicBrainz, cached in Neon)
 *   4. if MB can't confirm, return needsOverride so the group can vote to
 *      accept an obscure-but-real song instead of hard-failing
 *
 * No verification ever happens before submit, so this can't act as search.
 */

const { validateMove, stem, rawTokens } = require('../lib/wordlink');
const { verifySong } = require('../lib/verify');
const { Client } = require('pg');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const { prev, next, linkWord, forbiddenStem, allowOverride } = req.body || {};

  if (!next?.title || !next?.artist || !linkWord) {
    return res.status(400).json({ error: 'next.title, next.artist, linkWord required' });
  }

  // Opening move: no previous song, no link needed.
  const isOpening = !prev?.title;

  if (!isOpening) {
    const v = validateMove(prev, next, linkWord, forbiddenStem || null);
    if (!v.ok) {
      return res.status(200).json({ accepted: false, reason: v.reason });
    }
  }

  // Structural link is fine — now (and only now) verify the song is real.
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
      // group has voted to accept an obscure/real song MB didn't return
      return res.status(200).json({
        accepted: true,
        override: true,
        linkStem: isOpening ? null : stem(rawTokens(linkWord)[0] || ''),
      });
    }
    return res.status(200).json({
      accepted: false,
      reason: verification.error ? 'VERIFY_UNAVAILABLE' : 'SONG_NOT_FOUND',
      needsOverride: true,
    });
  }

  return res.status(200).json({
    accepted: true,
    canonicalTitle: verification.canonicalTitle,
    canonicalArtist: verification.canonicalArtist,
    linkStem: isOpening ? null : stem(rawTokens(linkWord)[0] || ''),
  });
};
