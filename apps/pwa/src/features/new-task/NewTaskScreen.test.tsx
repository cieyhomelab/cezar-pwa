import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithQuery } from '../../../test/query.tsx'
import { AuthRequiredError, NetworkError, TimeoutError } from '../../api/http.ts'
import { en } from '../../i18n/en.ts'
import { AppRoutes } from '../../routes.tsx'
import { createFailureMessage } from './useCreateRun.ts'

/**
 * S-13: the new-task form (FR-033) and landing on the task it made (FR-034). A refusal shows
 * Cezar's own words and keeps the description (FR-032).
 */

const t = en.newTask

const health = {
  version: '0.11.0',
  projects: [
    { id: 'kai-phone', name: 'kai-phone' },
    { id: 'cezar-pwa', name: 'cezar-pwa' },
  ],
  bootProject: 'kai-phone',
  defaultRunner: 'claude',
  checks: [
    { name: 'claude', available: true },
    { name: 'codex', available: false },
    { name: 'gh', available: true },
  ],
}

const workflows = {
  workflows: [
    { name: 'Ciey-issue-fix', steps: [], source: 'file' },
    { name: 'quick-task', steps: [], source: 'built-in' },
  ],
  issues: [],
}

const config = { defaultRunner: 'claude', defaultModels: { claude: 'sonnet' }, modelsLocked: false }

const models = {
  runner: 'claude',
  models: [
    { id: 'opus[1m]', label: 'Opus (1M context)', description: '' },
    { id: 'sonnet', label: 'Sonnet', description: '' },
  ],
  source: 'cache',
  stale: false,
}

const record = { id: 'a1b2c3d4', status: 'queued', task: 'x', steps: [] }

type Overrides = {
  create?: (body: unknown) => Response
  profiles?: unknown
  config?: unknown
}

function serve(path = '/new', overrides: Overrides = {}) {
  const creates: { project: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const method = init?.method ?? 'GET'
    const create = url.pathname.match(/^\/api\/v1\/p\/([^/]+)\/runs$/)
    if (create && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      creates.push({ project: decodeURIComponent(create[1]!), body })
      return overrides.create ? overrides.create(body) : jsonResponse(record, 201)
    }
    switch (url.pathname) {
      case '/api/v1/health':
        return jsonResponse(health)
      case '/api/v1/p/kai-phone/workflows':
      case '/api/v1/p/cezar-pwa/workflows':
        return jsonResponse(workflows)
      case '/api/v1/p/kai-phone/config':
      case '/api/v1/p/cezar-pwa/config':
        return jsonResponse(overrides.config ?? config)
      case '/api/v1/models':
        return jsonResponse(models)
      case '/api/v1/workspace/agent-profiles':
        return jsonResponse(overrides.profiles ?? { editable: false, profiles: [], profileCapableProviders: [], selections: {}, defaults: {} })
      case '/api/v1/workspace/runs-index':
        return jsonResponse({ runs: [], referenceStatuses: {}, perProjectLimit: 200, truncated: [] })
      default:
        // The task screen the form lands on: nothing it asks for matters here.
        if (url.pathname.startsWith('/api/v1/p/kai-phone/runs/a1b2c3d4')) return new Promise<Response>(() => {})
        throw new Error(`unrouted fetch in test: ${method} ${url.pathname}`)
    }
  })
  const view = renderWithQuery(<AppRoutes />, undefined, path)
  return { creates, ...view }
}

const describeTask = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: t.task }), { target: { value: text } })

const submit = () => fireEvent.click(screen.getByRole('button', { name: t.submit }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the new-task form', () => {
  it("preselects what the cockpit would: the boot project, quick-task, the project's runner and model preset", async () => {
    serve()
    expect(await screen.findByRole('combobox', { name: t.workflow })).toHaveValue('quick-task')
    expect(screen.getByRole('combobox', { name: t.project })).toHaveValue('kai-phone')
    expect(screen.getByRole('combobox', { name: t.runner })).toHaveValue('claude')
    await waitFor(() => expect(screen.getByRole('combobox', { name: t.model })).toHaveValue('sonnet'))
    expect(screen.getByRole('switch', { name: new RegExp(t.autonomous) })).not.toBeChecked()
  })

  it('offers only installed runners and hides the account picker when there are no accounts', async () => {
    serve()
    const runner = await screen.findByRole('combobox', { name: t.runner })
    expect([...runner.querySelectorAll('option')].map((option) => option.value)).toEqual(['claude'])
    expect(screen.queryByRole('combobox', { name: t.account })).not.toBeInTheDocument()
  })

  it("offers the runner's accounts when there are some", async () => {
    serve('/new', {
      profiles: {
        editable: true,
        profiles: [
          { id: 'work', provider: 'claude', label: 'Work' },
          { id: 'oss', provider: 'codex', label: 'OSS' },
        ],
        profileCapableProviders: ['claude'],
        selections: {},
        defaults: {},
      },
    })
    const account = await screen.findByRole('combobox', { name: t.account })
    expect([...account.querySelectorAll('option')].map((option) => option.textContent)).toEqual([t.accountDefault, 'Work'])
  })

  it('says the model is locked instead of offering a pick', async () => {
    serve('/new', { config: { ...config, modelsLocked: true } })
    expect(await screen.findByText(t.modelLocked)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: t.model })).not.toBeInTheDocument()
  })

  it('starts with the project the list was filtered to', async () => {
    serve('/new?project=cezar-pwa')
    expect(await screen.findByRole('combobox', { name: t.project })).toHaveValue('cezar-pwa')
  })

  it('cannot be sent without a description', async () => {
    serve()
    await screen.findByRole('combobox', { name: t.workflow })
    expect(screen.getByRole('button', { name: t.submit })).toBeDisabled()
    describeTask('   ')
    expect(screen.getByRole('button', { name: t.submit })).toBeDisabled()
  })

  it('creates the task with every choice and lands on it (FR-034)', async () => {
    const { creates, client } = serve()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await screen.findByRole('combobox', { name: t.workflow })
    await waitFor(() => expect(screen.getByRole('combobox', { name: t.model })).toHaveValue('sonnet'))

    describeTask('Fix the flaky test')
    fireEvent.change(screen.getByRole('combobox', { name: t.workflow }), { target: { value: 'Ciey-issue-fix' } })
    fireEvent.change(screen.getByRole('combobox', { name: t.model }), { target: { value: 'opus[1m]' } })
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(t.autonomous) }))
    submit()

    expect(await screen.findByText(en.run.loading)).toBeInTheDocument()
    expect(creates).toEqual([
      {
        project: 'kai-phone',
        body: { task: 'Fix the flaky test', workflow: 'Ciey-issue-fix', runner: 'claude', model: 'opus[1m]', autonomous: true },
      },
    ])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['runs-index'] })
  })

  it('sends no model when Auto is picked', async () => {
    const { creates } = serve()
    await waitFor(() => expect(screen.getByRole('combobox', { name: t.model })).toHaveValue('sonnet'))
    describeTask('x')
    fireEvent.change(screen.getByRole('combobox', { name: t.model }), { target: { value: '' } })
    submit()
    await waitFor(() => expect(creates).toHaveLength(1))
    expect(creates[0]!.body).not.toHaveProperty('model')
  })

  it("shows the server's refusal verbatim and keeps the description (FR-032)", async () => {
    const { creates } = serve('/new', {
      create: () => jsonResponse({ error: 'unknown workflow "nope"' }, 400),
    })
    await screen.findByRole('combobox', { name: t.workflow })
    describeTask('Keep every word of this')
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(t.failed.refused('unknown workflow "nope"'))
    expect(screen.getByRole('textbox', { name: t.task })).toHaveValue('Keep every word of this')
    expect(screen.getByRole('button', { name: t.submit })).toBeEnabled()
    expect(creates).toHaveLength(1)
  })

  it('lands on the first run when the server answers with a group', async () => {
    serve('/new', { create: () => jsonResponse({ runs: [record, { ...record, id: 'e5f6' }] }, 201) })
    await screen.findByRole('combobox', { name: t.workflow })
    describeTask('x')
    submit()
    expect(await screen.findByText(en.run.loading)).toBeInTheDocument()
  })
})

describe('createFailureMessage', () => {
  it.each([
    ['a lapsed session', new AuthRequiredError(403), t.failed.auth],
    ['a timeout may have started one', new TimeoutError(20_000), t.failed.timeout],
    ['no network sent nothing', new NetworkError('down'), t.failed.network],
  ])('%s', (_, error, expected) => {
    expect(createFailureMessage(error)).toBe(expected)
  })
})
