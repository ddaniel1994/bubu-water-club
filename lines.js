// The reminder copy, in one place because two surfaces read it: `content.js` draws it inside the page bubble and
// `background.js` puts the same sentence in the OS notification. The *picker* is shared too, not just the list:
// one stamp and one previous line then give one caption everywhere, where sharing only the words would let the
// two hashes drift apart the moment either side is tweaked.
globalThis.BUBU_LINES = [
  'Bubu, thanni kudichiya?',
  'Thanni kudi kunjipenne',
  'Konjam thanni kudi papa',
  'Did my good girl drink water?',
  'Papa, oru cutting?',
  'Vellam kudicho muthe?',
  'Vellam kudikkan maranno?',
  'Vellam kudikkan samayamaayi!',
  'Thanni kudichiya chellam?',
  'Konjam thanni kudichukko!'
];
// Uniform over every line except the one on screen: the re-roll happens inside the remaining n-1 rather than at
// i+1, so no line is likelier to follow another. The avalanche keeps the sequence from tracking the alarm
// interval, and a `prev` of -1 (nothing shown yet) skips nothing.
globalThis.bubuLine = (stamp, prev, n) => {
  if(!(n > 0)) return -1;
  let h = (Number(stamp) || 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  let i = (h >>> 0) % n;
  if(n > 1 && i === prev) i = (i + 1 + ((h >>> 8) % (n - 1))) % n;
  return i;
};
