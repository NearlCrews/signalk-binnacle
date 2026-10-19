// Pull one attribute value out of a server-rendered tag string, for SSR component tests that
// assert an association (aria-describedby, aria-controls, for) without a DOM.
export function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

// Pull one tag out of server-rendered HTML, throwing when absent so an assertion against the
// result cannot silently pass on a missing element. The companion half of attribute() above.
export function tag(html: string, pattern: RegExp, description: string): string {
  const match = html.match(pattern);
  if (!match) throw new Error(`${description} not rendered`);
  return match[0];
}

// The text a reader meets in server-rendered markup: comments dropped, each tag read as a space, and
// whitespace collapsed. A scan rather than a regex replace, which could leave a partial comment.
export function visibleText(html: string): string {
  let text = '';
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open === -1) {
      text += html.slice(index);
      break;
    }
    text += html.slice(index, open);
    const comment = html.startsWith('<!--', open);
    const close = comment ? html.indexOf('-->', open + 4) : html.indexOf('>', open + 1);
    if (!comment) text += ' ';
    index = close === -1 ? html.length : close + (comment ? 3 : 1);
  }
  return text.replace(/\s+/g, ' ').trim();
}
