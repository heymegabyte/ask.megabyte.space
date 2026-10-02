/**
 * Ask — client entry. Mounts the SPA and the Kumo portal/toast providers so
 * dialogs, tooltips, and toasts render correctly, then hands off to <App/>,
 * which resolves the room from the URL path.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider, TooltipProvider } from '@cloudflare/kumo';
import { App } from './App';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('root element missing');

// Overlays (Toast, Tooltip, DropdownMenu) portal to document.body by default —
// no KumoPortalProvider needed since we're not inside a Shadow DOM.
createRoot(el).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
