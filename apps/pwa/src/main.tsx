import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { AppRoutes } from './routes.tsx'

// Server state lives here and nowhere else; SSE will update it through
// queryClient.setQueryData (CLAUDE.md → "Konwencje kodu").
const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* The app is mounted under /m/, so every route is relative to it. */}
      <BrowserRouter basename="/m">
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
