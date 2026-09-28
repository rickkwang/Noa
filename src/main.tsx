import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Before the first render, so the titlebar never paints with the wrong
// traffic-light clearance (see --noa-titlebar-inset in index.css).
if (window.noaDesktop) document.documentElement.dataset.desktop = 'true';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
