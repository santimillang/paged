export type Route =
  | { name: 'map' }
  | { name: 'concepts' }
  | { name: 'incident'; id: string }
  | { name: 'debrief'; id: string };

export function parseHash(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/');
  if (first === 'concepts') return { name: 'concepts' };
  if ((first === 'incident' || first === 'debrief') && second) {
    try {
      return { name: first, id: decodeURIComponent(second) };
    } catch {
      return { name: 'map' }; // malformed escape such as "%E0"
    }
  }
  return { name: 'map' };
}

export function href(r: Route): string {
  switch (r.name) {
    case 'map':
      return '#/';
    case 'concepts':
      return '#/concepts';
    default:
      return `#/${r.name}/${encodeURIComponent(r.id)}`;
  }
}

export function go(r: Route): void {
  window.location.hash = href(r);
}

/** Like go(), but replaces the current history entry so Back doesn't bounce into the redirect again. */
export function redirect(r: Route, loc: Pick<Location, 'replace'> = window.location): void {
  loc.replace(href(r));
}
