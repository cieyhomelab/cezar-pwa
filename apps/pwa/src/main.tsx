import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import App from './App.tsx'
import './index.css'

// Server state lives here and nowhere else; SSE will update it through
// queryClient.setQueryData (CLAUDE.md → "Konwencje kodu").
const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* The app is mounted under /m/, so every route is relative to it. */}
      <BrowserRouter basename="/m">
        <Routes>
          <Route path="/" element={<App />} />
          {/* Until the run screen exists (M2), deep links — including the one a
              push notification opens — land on the shell instead of a 404. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
