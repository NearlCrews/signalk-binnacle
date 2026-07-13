// Build a portable, bounded filename for downloads that may move between operating systems.
export function portableFilename(name: string, fallback: string, extension: string): string {
  const portableName = Array.from(name || fallback, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f ? '-' : character;
  }).join('');
  const stem = portableName
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return `${stem || fallback}.${extension}`;
}
