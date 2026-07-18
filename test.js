const { stem, linkableWords, validateMove, wordIsInSong } = require('./lib/wordlink');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else      { fail++; console.log(`  FAIL  ${name}`); }
}

console.log('\n--- Stemmer (the conjugation rules the user described) ---');
check('happy ~ happier',        stem('happy')      === stem('happier'));
check('happy ~ happiest',       stem('happy')      === stem('happiest'));
check('property ~ properties',  stem('property')   === stem('properties'));
check('rush ~ rushed',          stem('rush')       === stem('rushed'));
check('rush ~ rushing',         stem('rush')       === stem('rushing'));
check('love ~ loves ~ loved',   stem('love') === stem('loves') && stem('loves') === stem('loved'));
check('song ~ songs',           stem('song')       === stem('songs'));
check('kiss NOT ki (not -ss)',  stem('kiss')       === 'kiss');
check('run ~ running',          stem('run')        === stem('running'));
check('quick ~ quickly',        stem('quick')      === stem('quickly'));
check('boom stays boom',        stem('boom')       === 'boom');

console.log('\n--- Stop words excluded from linkable set ---');
const lw = linkableWords('I Will Always Love You', 'Whitney Houston');
const stems = lw.map(x => x.stem);
check('"I" excluded',       !stems.includes('i'));
check('"will" present',     stems.includes('will'));
check('"always" present',   stems.includes('always'));
check('"love" present',     stems.includes('love'));
check('"you" excluded',     !stems.includes('you'));
check('artist words present', stems.includes('whitney') && stems.includes('houston'));

console.log("\n--- The user's exact car-game chain ---");
// 1. Opening: The Power of Love — Huey Lewis
// 2. I Will Always Love You — Whitney Houston   (link: love)
const m1 = validateMove(
  { title: 'The Power of Love', artist: 'Huey Lewis and the News' },
  { title: 'I Will Always Love You', artist: 'Whitney Houston' },
  'love', null);
check('1->2 links on "love"', m1.ok && m1.linkStem === stem('love'));

// 3. Always — Saliva   (link: always, NOT love)
const m2 = validateMove(
  { title: 'I Will Always Love You', artist: 'Whitney Houston' },
  { title: 'Always', artist: 'Saliva' },
  'always', stem('love'));
check('2->3 links on "always"', m2.ok && m2.linkStem === stem('always'));

const m2bad = validateMove(
  { title: 'I Will Always Love You', artist: 'Whitney Houston' },
  { title: 'Always', artist: 'Saliva' },
  'love', stem('love'));
check('2->3 REJECTS reusing "love"', !m2bad.ok && m2bad.reason === 'LINK_REUSES_FORBIDDEN_WORD');

// 4. Click, Click, Boom — Saliva   (link: saliva [artist], NOT always)
const m3 = validateMove(
  { title: 'Always', artist: 'Saliva' },
  { title: 'Click Click Boom', artist: 'Saliva' },
  'saliva', stem('always'));
check('3->4 links on artist "saliva"', m3.ok && m3.linkStem === stem('saliva'));

const m3bad = validateMove(
  { title: 'Always', artist: 'Saliva' },
  { title: 'Click Click Boom', artist: 'Saliva' },
  'always', stem('always'));
check('3->4 REJECTS reusing "always"', !m3bad.ok && m3bad.reason === 'LINK_REUSES_FORBIDDEN_WORD');

// 5. Boom Boom Pow — Black Eyed Peas   (link: boom, NOT saliva)
const m4 = validateMove(
  { title: 'Click Click Boom', artist: 'Saliva' },
  { title: 'Boom Boom Pow', artist: 'The Black Eyed Peas' },
  'boom', stem('saliva'));
check('4->5 links on "boom"', m4.ok && m4.linkStem === stem('boom'));

console.log('\n--- Conjugation across a link (the flexible-matching rule) ---');
// "Loving" in one title should link to "Love" in another
const conj = validateMove(
  { title: 'Crazy Loving Heart', artist: 'Nobody' },
  { title: 'Love Song', artist: 'Sara Bareilles' },
  'love', null);
check('"loving" links to "love"', conj.ok);

console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
process.exit(fail ? 1 : 0);
