import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Placeholder. The admin workstream replaces this with the real panel.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <p style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>The admin panel is not built yet.</p>
  </StrictMode>,
);
