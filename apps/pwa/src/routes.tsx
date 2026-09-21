import { Navigate, Route, Routes } from 'react-router'
import App from './App.tsx'
import { DiffScreen } from './features/diff/DiffScreen.tsx'
import { RunScreen } from './features/run/RunScreen.tsx'
import { RunsListScreen } from './features/runs-list/RunsListScreen.tsx'

/**
 * Every screen, relative to the router's `/m/` basename. `App` is the layout: its chrome and the
 * session gate wrap whichever screen matches.
 *
 * The task path is the one S-10's notifications will open (`/m/p/:projectId/runs/:runId`, see
 * `runPath`). Anything else lands on the list rather than on a 404.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<App />}>
        <Route index element={<RunsListScreen />} />
        <Route path="p/:projectId/runs/:runId" element={<RunScreen />} />
        <Route path="p/:projectId/runs/:runId/diff" element={<DiffScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
