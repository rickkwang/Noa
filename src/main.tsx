import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Set before first render so the titlebar never paints with the wrong traffic-light clearance (--noa-titlebar-inset).
if (window.noaDesktop) document.documentElement.dataset.desktop = 'true';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
