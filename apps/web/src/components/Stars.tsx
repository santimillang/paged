export function Stars({ n, label = true }: { n: number; label?: boolean }) {
  return (
    <span className="stars" aria-label={label ? `${n} of 3 stars` : undefined}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? 'star on' : 'star'} aria-hidden>
          {i <= n ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}
