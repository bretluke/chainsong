/**
 * wordlink.js — core game logic for Chainsong.
 *
 * Responsibilities:
 *  1. Tokenize a song title + artist into "linkable" words
 *  2. Filter out stop words (the, a, I, me, prepositions, etc.)
 *  3. Stem words so conjugations/plurals match
 *     (happy~happier, property~properties, rush~rushed, run~running,
 *      surfin'~surfing~surf)
 *  4. Decide whether a chosen linking word is valid given the rule that
 *     you may NOT reuse the word that linked INTO the current song.
 *
 * Two-tier stop words:
 *   HARD_STOP — always filtered (articles, prepositions, copulas,
 *   conjunctions). These are never valid link words in any situation.
 *
 *   SOFT_STOP — pronouns (I, me, my, you, he, she, it, we, they, and
 *   their forms). Normally filtered so the game isn't trivialized by
 *   letting every song link on "you" or "me", but promoted to valid
 *   links via `linkableWordsFallback` when a song has no primary
 *   options left (e.g., titles like "Me, Myself & I" or "You and I").
 *
 * The server accepts any word from the fallback set as a valid link
 * (see wordIsInSong below), so if the client picker offers a pronoun
 * as a fallback, the server won't reject the move.
 *
 * The client-side JavaScript in public/index.html mirrors this file
 * verbatim — keep them in sync.
 */

const HARD_STOP = new Set([
  // articles
  'a', 'an', 'the',
  // prepositions / conjunctions / particles
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
  'as', 'is', 'be', 'am', 'are', 'was', 'were', 'been',
  'and', 'or', 'but', 'nor', 'so', 'yet',
  'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'up', 'out', 'off', 'over', 'into', 'onto', 'down',
  'no', 'not', 'do', 'does', 'did',
  'n', // leftover from contraction splitting (don't -> don t)
]);

const SOFT_STOP = new Set([
  // personal pronouns + close kin — filtered in normal play, allowed
  // as fallback when a title is nothing but these
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'u',
  'he', 'him', 'his', 'she', 'her', 'hers',
  'it', 'its', 'we', 'us', 'our', 'ours',
  'they', 'them', 'their', 'theirs',
]);

// The combined set — what the picker uses for its default "primary" view.
const STOP_WORDS = new Set([...HARD_STOP, ...SOFT_STOP]);

function rawTokens(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')                     // strip accents
    .replace(/[\u0027\u2018\u2019\u02BC]/g, '')          // strip all apostrophe variants
    .replace(/\b([a-z](?:\.[a-z])+)\.?/g, m => m.replace(/\./g, '')) // P.O.D. -> pod
    .replace(/[^a-z0-9 ]+/g, ' ')                        // remaining punctuation -> space
    .split(/\s+/)
    .filter(Boolean);
}

function stem(word) {
  const w = word;

  const IRREGULAR = {
    children: 'child', men: 'man', women: 'woman', people: 'person',
    feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose',
    better: 'good', best: 'good', worse: 'bad', worst: 'bad',
    ran: 'run', running: 'run', runs: 'run',
    went: 'go', gone: 'go', going: 'go', goes: 'go',
    loved: 'love', loving: 'love', loves: 'love',
    rushed: 'rush', rushing: 'rush', rushes: 'rush',
    always: 'always', perhaps: 'perhaps', across: 'across',
  };
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 3) return w;

  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ied') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('es')  && w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);

  // Full -ing: running -> run, jumping -> jump.
  if (w.endsWith('ing') && w.length > 5) {
    let base = w.slice(0, -3);
    if (/([bdfgklmnprt])\1$/.test(base)) base = base.slice(0, -1);
    return base;
  }

  // Contracted -in' (apostrophe already stripped by rawTokens): surfin -> surf,
  // rockin -> rock, livin -> liv (same stem "living" would take). Length > 4
  // stays conservative — avoids mangling unrelated short words like "cabin"
  // or "robin" or "satin" which are 5 or fewer characters, while catching the
  // song-lyric contractions that are usually 6+.
  if (w.endsWith('in') && w.length > 4) {
    let base = w.slice(0, -2);
    if (/([bdfgklmnprt])\1$/.test(base)) base = base.slice(0, -1);
    return base;
  }

  if (w.endsWith('ed') && w.length > 4) {
    let base = w.slice(0, -2);
    if (/([bdfgklmnprt])\1$/.test(base)) base = base.slice(0, -1);
    return base;
  }
  if (w.endsWith('iest') && w.length > 5) return w.slice(0, -4) + 'y';
  if (w.endsWith('ier')  && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('est')  && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('er')   && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly')   && w.length > 4) return w.slice(0, -2);

  const KEEP_S = /(ss|us|is|os|as)$/;
  if (w.endsWith('s') && !KEEP_S.test(w) && w.length > 3) {
    return w.slice(0, -1);
  }

  return w;
}

// Internal helper: tokenize title+artist, apply the given stop set,
// dedupe by stem.
function _extractLinkable(title, artist, stopSet) {
  const seen = new Set();
  const out = [];
  for (const source of [title, artist]) {
    for (const tok of rawTokens(source)) {
      if (stopSet.has(tok)) continue;
      if (tok.length < 2) continue;
      const s = stem(tok);
      if (stopSet.has(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push({ display: tok, stem: s });
    }
  }
  return out;
}

// Primary link words — pronouns filtered out. This is what the picker
// shows normally.
function linkableWords(title, artist) {
  return _extractLinkable(title, artist, STOP_WORDS);
}

// Full link words — pronouns included. Client shows these as a fallback
// when the primary set would leave the player with no viable options.
// Server always validates against this set, so any word the client
// offers as a fallback is accepted.
function linkableWordsFallback(title, artist) {
  return _extractLinkable(title, artist, HARD_STOP);
}

/**
 * Does `word` (the player's chosen link) appear in the given song's title
 * or artist? Uses the fallback set on the server side so pronouns the
 * client offers as fallback validate correctly.
 */
function wordIsInSong(word, title, artist) {
  const target = stem(rawTokens(word)[0] || '');
  if (!target) return null;
  for (const lw of linkableWordsFallback(title, artist)) {
    if (lw.stem === target) return lw.stem;
  }
  return null;
}

/**
 * Validate a full move.
 *
 *  prev            = { title, artist }   the song already on the board
 *  next            = { title, artist }   the song the player is naming
 *  linkWord                              the word the player says connects them
 *  forbiddenStem                         the stem that linked INTO `prev`
 *                                        (cannot be reused). null for opening.
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
  HARD_STOP,
  SOFT_STOP,
  STOP_WORDS,
  rawTokens,
  stem,
  linkableWords,
  linkableWordsFallback,
  wordIsInSong,
  validateMove,
};
