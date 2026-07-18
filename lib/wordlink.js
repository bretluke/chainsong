/**
 * wordlink.js — core game logic for SongLink
 *
 * Responsibilities:
 *  1. Tokenize a song title + artist into "linkable" words
 *  2. Filter out stop words (the, a, I, me, prepositions, etc.)
 *  3. Stem words so conjugations/plurals match
 *     (happy~happier, property~properties, rush~rushed, run~running)
 *  4. Decide whether a chosen linking word is valid given the rule that
 *     you may NOT reuse the word that linked INTO the current song.
 *
 * This file is pure logic with zero dependencies so it can be unit-tested
 * in isolation and reused by both the API and (later) native clients.
 */

// Words too small/common to be used as links. Kept deliberately tight —
// the user asked to block articles, the pronoun "I"/"me", and prepositions,
// not all common words.
const STOP_WORDS = new Set([
  // articles
  'a', 'an', 'the',
  // personal pronouns the user explicitly called out + close kin
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'u',
  'he', 'him', 'his', 'she', 'her', 'hers',
  'it', 'its', 'we', 'us', 'our', 'ours',
  'they', 'them', 'their', 'theirs',
  // prepositions / conjunctions / particles
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
  'as', 'is', 'be', 'am', 'are', 'was', 'were', 'been',
  'and', 'or', 'but', 'nor', 'so', 'yet',
  'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'up', 'out', 'off', 'over', 'into', 'onto', 'down',
  'no', 'not', 'do', 'does', 'did',
  "n", // leftover from contraction splitting (don't -> don t)
]);

/**
 * Normalize raw text: lowercase, strip punctuation/diacritics, split on
 * whitespace. Apostrophes are removed so "don't" -> "dont", "rock'n" -> "rockn".
 */
function rawTokens(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')      // strip accents
    .replace(/['’]/g, '')                  // drop apostrophes
    .replace(/[^a-z0-9 ]+/g, ' ')          // punctuation -> space
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * A small, deterministic stemmer. This is intentionally NOT a full Porter
 * stemmer — we want predictable behavior the user can reason about, covering
 * exactly the cases described: plurals, -ed, -ing, -er/-est, -ly, -ies.
 *
 * Returns the stem (the "canonical form") used for equality comparison.
 */
function stem(word) {
  let w = word;

  // irregulars worth special-casing because the game will hit them a lot
  const IRREGULAR = {
    children: 'child', men: 'man', women: 'woman', people: 'person',
    feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose',
    better: 'good', best: 'good', worse: 'bad', worst: 'bad',
    ran: 'run', running: 'run', runs: 'run',
    went: 'go', gone: 'go', going: 'go', goes: 'go',
    loved: 'love', loving: 'love', loves: 'love',
    rushed: 'rush', rushing: 'rush', rushes: 'rush',
    // not a plural — protect from the -s rule
    always: 'always', perhaps: 'perhaps', across: 'across',
  };
  if (IRREGULAR[w]) return IRREGULAR[w];

  if (w.length <= 3) return w; // too short to safely strip suffixes

  // -ies -> -y   (properties -> property, cries -> cry)
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';

  // -ied -> -y   (cried -> cry)
  if (w.endsWith('ied') && w.length > 4) return w.slice(0, -3) + 'y';

  // -ied/-ies handled; now -es -> drop (boxes -> box, wishes -> wish)
  if (w.endsWith('es') && w.length > 4 &&
      /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);

  // -ied done; generic -ing
  if (w.endsWith('ing') && w.length > 5) {
    let base = w.slice(0, -3);
    // doubled consonant: running -> run, stopping -> stop
    if (/([bdfgklmnprt])\1$/.test(base)) base = base.slice(0, -1);
    return base;
  }

  // -ed (loved handled above as irregular; jumped -> jump)
  if (w.endsWith('ed') && w.length > 4) {
    let base = w.slice(0, -2);
    if (/([bdfgklmnprt])\1$/.test(base)) base = base.slice(0, -1);
    return base;
  }

  // -est / -er comparatives (happiest->happy via -iest, faster->fast)
  if (w.endsWith('iest') && w.length > 5) return w.slice(0, -4) + 'y';
  if (w.endsWith('ier')  && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('est')  && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('er')   && w.length > 4) return w.slice(0, -2);

  // -ly adverbs (quickly -> quick)
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);

  // plain plural -s (songs -> song) but NOT:
  //   -ss  (kiss, across stay intact)
  //   -us  (famous, dangerous, jealous — adjectives, not plurals)
  //   -is  (this, paris — usually not a plural we want to strip)
  //   words where dropping -s leaves a non-word-ish 1-2 char stub
  // This is conservative on purpose: a missed plural is a minor annoyance,
  // but mangling "always"->"alway" or "famous"->"famou" breaks real songs.
  const KEEP_S = /(ss|us|is|os|as)$/;
  if (w.endsWith('s') && !KEEP_S.test(w) && w.length > 3) {
    return w.slice(0, -1);
  }

  return w;
}

/**
 * Public: given a title and artist, return the set of linkable words as
 * { display, stem } pairs, de-duplicated by stem. Stop words removed.
 */
function linkableWords(title, artist) {
  const seen = new Set();
  const out = [];
  for (const source of [title, artist]) {
    for (const tok of rawTokens(source)) {
      if (STOP_WORDS.has(tok)) continue;
      if (tok.length < 2) continue;
      const s = stem(tok);
      if (STOP_WORDS.has(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push({ display: tok, stem: s });
    }
  }
  return out;
}

/**
 * Public: does `word` (the player's chosen link) actually appear in the
 * given song's title or artist?  Comparison is on stems so conjugations
 * match.  Returns the matched stem or null.
 */
function wordIsInSong(word, title, artist) {
  const target = stem(rawTokens(word)[0] || '');
  if (!target) return null;
  for (const lw of linkableWords(title, artist)) {
    if (lw.stem === target) return lw.stem;
  }
  return null;
}

/**
 * Public: validate a full move.
 *
 *  prev   = { title, artist }            the song already on the board
 *  next   = { title, artist }            the song the player is naming
 *  linkWord                              the word the player says connects them
 *  forbiddenStem                         the stem that was used to link INTO
 *                                        `prev` (cannot be reused) — null if
 *                                        prev is the opening song
 *
 * Returns { ok: true, linkStem } or { ok: false, reason }.
 */
function validateMove(prev, next, linkWord, forbiddenStem) {
  const inPrev = wordIsInSong(linkWord, prev.title, prev.artist);
  if (!inPrev) {
    return { ok: false, reason: 'LINK_NOT_IN_PREVIOUS' };
  }
  if (forbiddenStem && inPrev === forbiddenStem) {
    return { ok: false, reason: 'LINK_REUSES_FORBIDDEN_WORD' };
  }
  const inNext = wordIsInSong(linkWord, next.title, next.artist);
  if (!inNext) {
    return { ok: false, reason: 'LINK_NOT_IN_NEW_SONG' };
  }
  return { ok: true, linkStem: inPrev };
}

module.exports = {
  STOP_WORDS,
  rawTokens,
  stem,
  linkableWords,
  wordIsInSong,
  validateMove,
};
