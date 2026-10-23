export type Route =
  | { name: 'map' }
  | { name: 'concepts' }
  | { name: 'incident'; id: string }
  | { name: 'debrief'; id: string };

export function parseHash(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/');
  if (first === 'concepts') return { name: 'concepts' };
  if ((first === 'incident' || first === 'debrief') && second) return { name: first, id: decodeURIComponent(second) };
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
