import { Navigate, Route, Routes } from 'react-router'
import App from './App.tsx'
import { AutomationsScreen } from './features/automations/AutomationsScreen.tsx'
import { DiffScreen } from './features/diff/DiffScreen.tsx'
import { NewTaskScreen } from './features/new-task/NewTaskScreen.tsx'
import { RunScreen } from './features/run/RunScreen.tsx'
import { RunsListScreen } from './features/runs-list/RunsListScreen.tsx'
import { SettingsScreen } from './features/settings/SettingsScreen.tsx'

/**
 * Every screen, relative to the router's `/m/` basename. `App` is the layout: its chrome and the
 * session gate wrap whichever screen matches.
 *
 * The task path is the one S-10's notifications open (`/m/p/:projectId/runs/:runId`, see `runPath`
 * and `pwa/push-message.ts`). Anything else lands on the list rather than on a 404.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<App />}>
        <Route index element={<RunsListScreen />} />
        <Route path="new" element={<NewTaskScreen />} />
        <Route path="p/:projectId/runs/:runId" element={<RunScreen />} />
        <Route path="p/:projectId/runs/:runId/diff" element={<DiffScreen />} />
        <Route path="automations" element={<AutomationsScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
