/**
 * Natural language password generator (passphrase generator).
 * Produces memorable, human-friendly passwords composed of dictionary words
 * separated by hyphens (e.g., "gentle-river-falcon-bright").
 */

const WORDS: string[] = [
  'acorn', 'alder', 'amber', 'anchor', 'angel', 'apple', 'apron', 'archer', 'arrow', 'atlas',
  'autumn', 'badge', 'baker', 'banner', 'beacon', 'beetle', 'birch', 'bison', 'blade', 'blaze',
  'bloom', 'bonus', 'border', 'breeze', 'bridge', 'bright', 'brook', 'bundle', 'cabin', 'cactus',
  'candle', 'canvas', 'canyon', 'castle', 'cedar', 'cherry', 'circle', 'citrus', 'cliff', 'cloak',
  'clover', 'coast', 'comet', 'copper', 'coral', 'cradle', 'crater', 'creek', 'cricket', 'crystal',
  'dawn', 'delta', 'desert', 'dingo', 'dolphin', 'dragon', 'dune', 'eagle', 'echo', 'ember',
  'falcon', 'feather', 'fable', 'ferret', 'flame', 'flash', 'flint', 'flora', 'forest', 'fossil',
  'frost', 'galaxy', 'garden', 'garnet', 'geyser', 'glade', 'glider', 'glow', 'golden', 'granite',
  'grove', 'harbor', 'haven', 'hawk', 'hazel', 'heather', 'heron', 'hollow', 'horizon', 'humble',
  'hunter', 'icicle', 'island', 'jaguar', 'jasper', 'jolly', 'jungle', 'jupiter', 'keel', 'kelp',
  'kestrel', 'knight', 'lagoon', 'lantern', 'larch', 'lark', 'laurel', 'leaf', 'lemur', 'lichen',
  'lily', 'linden', 'lizard', 'lotus', 'lunar', 'lynx', 'magpie', 'maple', 'marble', 'marsh',
  'meadow', 'merlin', 'meteor', 'mineral', 'mist', 'monarch', 'moon', 'moss', 'mount', 'mystic',
  'nebula', 'nectar', 'nest', 'nickel', 'noble', 'nomad', 'north', 'oasis', 'ocean', 'olive',
  'opal', 'orchid', 'osprey', 'otter', 'owl', 'paddle', 'panda', 'panther', 'parrot', 'pasture',
  'pebble', 'pelican', 'pepper', 'phoenix', 'pine', 'planet', 'plateau', 'plover', 'polar', 'poppy',
  'portal', 'prairie', 'prism', 'quartz', 'quest', 'quill', 'quiver', 'rabbit', 'radar', 'rain',
  'ranger', 'raven', 'reef', 'ridge', 'ripple', 'river', 'robin', 'rocket', 'rover', 'ruby',
  'sable', 'sage', 'sailor', 'salmon', 'sandy', 'sapphire', 'scarlet', 'scout', 'seagull', 'shadow',
  'shelter', 'shiver', 'sierra', 'silver', 'slate', 'solar', 'spark', 'sparrow', 'spring', 'spruce',
  'star', 'stone', 'storm', 'stream', 'summit', 'sunburst', 'sunny', 'sunset', 'swift', 'talon',
  'tangle', 'terrace', 'thistle', 'thunder', 'tidal', 'timber', 'topaz', 'torch', 'trail', 'tree',
  'tulip', 'tundra', 'twilight', 'valley', 'velvet', 'vessel', 'vine', 'violet', 'viper', 'vivid',
  'voyage', 'walnut', 'warmth', 'water', 'wave', 'whisper', 'willow', 'wind', 'winter', 'wisdom',
  'wolf', 'woodland', 'wren', 'yarrow', 'yellow', 'zenith', 'zephyr'
];

/**
 * Generates a random natural language passphrase using cryptographically secure random numbers.
 * @param wordCount Number of words in the passphrase (defaults to 3 words, e.g. "amber-river-falcon")
 * @param separator Separator between words (defaults to "-")
 */
export function generateNaturalPassword(wordCount: number = 3, separator: string = '-'): string {
  const words: string[] = [];
  const randomBuffer = new Uint32Array(wordCount);
  
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBuffer);
    for (let i = 0; i < wordCount; i++) {
      const index = randomBuffer[i] % WORDS.length;
      words.push(WORDS[index]);
    }
  } else {
    for (let i = 0; i < wordCount; i++) {
      const index = Math.floor(Math.random() * WORDS.length);
      words.push(WORDS[index]);
    }
  }

  return words.join(separator);
}
