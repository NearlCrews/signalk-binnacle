// Pull one attribute value out of a server-rendered tag string, for SSR component tests that
// assert an association (aria-describedby, aria-controls, for) without a DOM.
export function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}
