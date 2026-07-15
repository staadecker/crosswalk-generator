/** Returns `word` unchanged if n === 1, else with `suffix` appended (default 's'). */
export function pluralize(n, word, suffix = 's') {
  return n === 1 ? word : `${word}${suffix}`;
}
