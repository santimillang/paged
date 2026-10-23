import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { content } from './content';

function Placeholder() {
  return <p>Paged: {content.scenarios.length} incidents loaded.</p>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Placeholder />
  </StrictMode>,
);
