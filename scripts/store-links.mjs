// The Signal K App Store renders README.md and CHANGELOG.md link targets unmodified and rewrites
// only image paths against the package root, so every other relative target is a dead link there.
const resolvableTarget = /^(?:https?:|mailto:|#)/iu;
const codeSpan = /`[^`]*`/gu;
const markdownImage = /!\[[^\]]*\]\([^)]*\)/gu;
const markdownLinkTarget = /\]\(\s*<?([^)\s>]+)/gu;
// Footnote definitions ([^1]:) carry prose, not a target, so they are excluded.
const referenceDefinition = /^\s{0,3}\[[^\]^][^\]]*\]:\s*<?([^\s>]+)/u;
const htmlAnchorTarget = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;

/** @param {string} line */
export function isFenceDelimiter(line) {
  return /^\s*(?:```|~~~)/u.test(line);
}

/**
 * Link targets the App Store cannot resolve: inline links, reference definitions, and HTML anchors
 * whose target is not http, https, mailto, or an in-page anchor. Image paths are allowed.
 * @param {string} source
 * @returns {{ line: number, target: string }[]}
 */
export function unresolvableStoreLinks(source) {
  /** @type {{ line: number, target: string }[]} */
  const failures = [];
  let inFence = false;
  source.split('\n').forEach((text, index) => {
    if (isFenceDelimiter(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const prose = text.replace(codeSpan, '');
    const targets = [
      ...[...prose.replace(markdownImage, '').matchAll(markdownLinkTarget)].map(
        (match) => match[1],
      ),
      ...[...prose.matchAll(htmlAnchorTarget)].map((match) => match[1] ?? match[2] ?? match[3]),
    ];
    const reference = referenceDefinition.exec(prose);
    if (reference) targets.push(reference[1]);
    for (const target of targets) {
      if (!resolvableTarget.test(target)) failures.push({ line: index + 1, target });
    }
  });
  return failures;
}
