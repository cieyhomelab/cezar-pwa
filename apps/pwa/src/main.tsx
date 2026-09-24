import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { applyTheme, readThemePreference } from './pwa/theme.ts'
import { AppRoutes } from './routes.tsx'

// S-12: a forced theme is in place before the first render, so the system's does not flash first.
applyTheme(readThemePreference())

// Server state lives here and nowhere else; SSE will update it through
// queryClient.setQueryData (CLAUDE.md → "Code conventions").
const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* The app is mounted under /m/, so every route is relative to it. The trailing slash is
          load-bearing: with `/m`, a link to the list resolves to `/m`, which is outside the
          service worker's scope and outside nginx's `location ^~ /m/` — a reload there reaches
          the gated cockpit instead of the app. */}
      <BrowserRouter basename="/m/">
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
