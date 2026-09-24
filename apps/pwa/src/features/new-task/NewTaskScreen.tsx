import type { Runner } from '@cezar-pwa/cezar-contract/contract'
import { useQuery } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { healthQueryOptions } from '../../api/health.ts'
import {
  agentProfilesQueryOptions,
  modelsQueryOptions,
  projectConfigQueryOptions,
  workflowsQueryOptions,
} from '../../api/new-task.ts'
import {
  initialModel,
  initialRunner,
  initialWorkflow,
  installedRunners,
  profilesFor,
} from '../../domain/new-task.ts'
import { apiErrorDetail } from '../../i18n/errors.ts'
import { en } from '../../i18n/en.ts'
import { useCreateRun } from './useCreateRun.ts'

/** The query parameter the list passes when it is filtered to one project. */
export const PROJECT_PARAM = 'project'

const fieldClass = 'touch-target w-full rounded border border-border bg-surface-raised px-2 text-base text-text'

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  )
}

/**
 * S-13: start a task from the phone (FR-033) and land on it (FR-034). Project, description,
 * workflow, agent, model and the autonomous switch; `variants`, `dispatch`, attachments and inline
 * steps stay in the cockpit (issue #62).
 *
 * Every choice starts at what the cockpit would preselect — the project's default runner and its
 * model preset, `quick-task` — until the operator picks otherwise. A refusal is shown in Cezar's
 * own words (FR-032) and the description stays in the field.
 */
export function NewTaskScreen() {
  const [params] = useSearchParams()
  const health = useQuery(healthQueryOptions())
  const projects = health.data?.projects ?? []

  const [projectChoice, setProjectChoice] = useState(params.get(PROJECT_PARAM) ?? undefined)
  const projectId =
    projects.find((project) => project.id === projectChoice)?.id ??
    projects.find((project) => project.id === health.data?.bootProject)?.id ??
    projects[0]?.id

  const [task, setTask] = useState('')
  const [workflowChoice, setWorkflowChoice] = useState<string>()
  const [runnerChoice, setRunnerChoice] = useState<Runner>()
  // `''` is an explicit "Auto"; `undefined` is "not chosen, use the preset".
  const [modelChoice, setModelChoice] = useState<string>()
  const [profileChoice, setProfileChoice] = useState('')
  const [autonomous, setAutonomous] = useState(false)

  const workflows = useQuery({ ...workflowsQueryOptions(projectId ?? ''), enabled: projectId !== undefined })
  const config = useQuery({ ...projectConfigQueryOptions(projectId ?? ''), enabled: projectId !== undefined })
  const profiles = useQuery(agentProfilesQueryOptions())

  const installed = installedRunners(health.data?.checks)
  const runner =
    runnerChoice && installed.includes(runnerChoice)
      ? runnerChoice
      : initialRunner(installed, config.data?.defaultRunner, health.data?.defaultRunner)
  const models = useQuery({ ...modelsQueryOptions(runner ?? 'claude'), enabled: runner !== undefined })

  const workflowNames = (workflows.data?.workflows ?? []).map((workflow) => workflow.name)
  const workflow =
    workflowChoice && workflowNames.includes(workflowChoice) ? workflowChoice : initialWorkflow(workflows.data?.workflows ?? [])

  const modelsLocked = config.data?.modelsLocked === true
  const offeredModels = models.data?.models ?? []
  const model = modelsLocked
    ? undefined
    : modelChoice !== undefined
      ? modelChoice || undefined
      : initialModel(runner ? config.data?.defaultModels[runner] : undefined, offeredModels)

  const accounts = profilesFor(profiles.data?.profiles, runner)
  const agentProfile = accounts.some((profile) => profile.id === profileChoice) ? profileChoice : undefined

  const create = useCreateRun()

  const back = (
    <div className="sticky top-0 z-20 flex h-11 items-center border-b border-border bg-surface px-2">
      <Link to="/" className="touch-target inline-flex items-center px-2 text-accent">
        <span aria-hidden="true">‹&nbsp;</span>
        {en.newTask.back}
      </Link>
    </div>
  )

  // The options a task cannot start without. Models and accounts are optional: without them
  // the form still sends a task, and the runner picks its own model.
  const loadError = workflows.error ?? config.error
  if (projectId !== undefined && loadError) {
    return (
      <div className="flex flex-1 flex-col">
        {back}
        <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p>{en.newTask.loadFailed}</p>
          {apiErrorDetail(loadError) ? <p className="text-sm text-text-muted">{apiErrorDetail(loadError)}</p> : null}
          <button
            type="button"
            className="touch-target rounded border border-border px-4 text-sm"
            onClick={() => {
              void workflows.refetch()
              void config.refetch()
            }}
          >
            {en.newTask.retry}
          </button>
        </section>
      </div>
    )
  }

  const ready = projectId !== undefined && workflow !== undefined && config.data !== undefined
  const canSubmit = ready && runner !== undefined && task.trim() !== '' && !create.pending

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit || workflow === undefined || projectId === undefined) return
    void create.submit(projectId, { task, workflow, runner, model, agentProfile, autonomous })
  }

  return (
    <div className="flex flex-1 flex-col">
      {back}
      <h2 className="px-4 pt-3 text-lg font-semibold">{en.newTask.title}</h2>
      <form aria-label={en.newTask.title} onSubmit={submit} className="flex flex-col gap-4 px-4 py-3">
        {projects.length > 1 ? (
          <Field label={en.newTask.project}>
            {(id) => (
              <select
                id={id}
                className={fieldClass}
                value={projectId ?? ''}
                disabled={create.pending}
                onChange={(event) => {
                  setProjectChoice(event.target.value)
                  // Another project has its own catalog and presets.
                  setWorkflowChoice(undefined)
                  setModelChoice(undefined)
                }}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}

        <Field label={en.newTask.task}>
          {(id) => (
            <textarea
              id={id}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder={en.newTask.taskPlaceholder}
              rows={6}
              // 16 px or more: iOS zooms the page into any smaller field it focuses.
              className="min-h-11 w-full resize-y rounded border border-border bg-surface-raised px-3 py-2.5 text-base"
              readOnly={create.pending}
              maxLength={100_000}
            />
          )}
        </Field>

        {!ready ? (
          <p role="status" className="text-sm text-text-muted">
            {en.newTask.loading}
          </p>
        ) : (
          <>
            <Field label={en.newTask.workflow}>
              {(id) => (
                <select
                  id={id}
                  className={fieldClass}
                  value={workflow}
                  disabled={create.pending}
                  onChange={(event) => setWorkflowChoice(event.target.value)}
                >
                  {workflowNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {installed.length === 0 ? (
              <p role="alert" className="text-sm text-danger">
                {en.newTask.noRunners}
              </p>
            ) : (
              <Field label={en.newTask.runner}>
                {(id) => (
                  <select
                    id={id}
                    className={fieldClass}
                    value={runner}
                    disabled={create.pending}
                    onChange={(event) => {
                      setRunnerChoice(event.target.value as Runner)
                      // Model ids belong to one runner.
                      setModelChoice(undefined)
                    }}
                  >
                    {installed.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}

            {runner === undefined ? null : modelsLocked ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-text-muted">{en.newTask.model}</span>
                <span className="text-sm">{en.newTask.modelLocked}</span>
              </div>
            ) : (
              <Field label={en.newTask.model}>
                {(id) => (
                  <select
                    id={id}
                    className={fieldClass}
                    value={model ?? ''}
                    disabled={create.pending}
                    onChange={(event) => setModelChoice(event.target.value)}
                  >
                    <option value="">{en.newTask.modelAuto}</option>
                    {offeredModels.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}

            {accounts.length > 0 ? (
              <Field label={en.newTask.account}>
                {(id) => (
                  <select
                    id={id}
                    className={fieldClass}
                    value={agentProfile ?? ''}
                    disabled={create.pending}
                    onChange={(event) => setProfileChoice(event.target.value)}
                  >
                    <option value="">{en.newTask.accountDefault}</option>
                    {accounts.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null}

            <label className="touch-target flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span>{en.newTask.autonomous}</span>
                <span className="text-sm text-text-muted">{en.newTask.autonomousHint}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="size-6 shrink-0 accent-accent"
                checked={autonomous}
                disabled={create.pending}
                onChange={(event) => setAutonomous(event.target.checked)}
              />
            </label>
          </>
        )}

        {create.error ? (
          <p role="alert" className="text-sm text-danger">
            {create.error}
          </p>
        ) : null}

        <button
          type="submit"
          className="touch-target rounded bg-accent px-4 font-semibold text-white disabled:opacity-60"
          disabled={!canSubmit}
        >
          {create.pending ? en.newTask.submitting : en.newTask.submit}
        </button>
      </form>
    </div>
  )
}
