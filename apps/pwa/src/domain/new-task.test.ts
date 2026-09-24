import type { AgentProfile, BackendCheck } from '@cezar-pwa/cezar-contract/contract'
import { describe, expect, it } from 'vitest'
import {
  createRunBody,
  createdRunId,
  discoversModels,
  initialModel,
  initialRunner,
  initialWorkflow,
  installedRunners,
  profilesFor,
} from './new-task.ts'

const check = (name: BackendCheck['name'], available: boolean): BackendCheck => ({ name, available })

describe('installedRunners', () => {
  it.each([
    ['only claude on this host', [check('claude', true), check('codex', false), check('gh', true), check('git', true)], ['claude']],
    ['in the contract order', [check('pi', true), check('codex', true), check('claude', true)], ['claude', 'codex', 'pi']],
    ['gh and git are not runners', [check('gh', true), check('git', true)], []],
    ['no checks at all', undefined, []],
  ] as const)('%s', (_, checks, expected) => {
    expect(installedRunners(checks as readonly BackendCheck[] | undefined)).toEqual(expected)
  })
})

describe('initialRunner', () => {
  it.each([
    ["the project's default when installed", ['claude', 'codex'], 'codex', 'claude', 'codex'],
    ["the host's when the project's is not installed", ['claude'], 'codex', 'claude', 'claude'],
    ['the first installed when neither is', ['opencode'], 'codex', 'claude', 'opencode'],
    ['none when nothing is installed', [], 'claude', 'claude', undefined],
  ] as const)('%s', (_, installed, project, host, expected) => {
    expect(initialRunner(installed, project, host)).toBe(expected)
  })
})

describe('initialWorkflow', () => {
  it.each([
    ['quick-task when listed', [{ name: 'Ciey-issue-fix' }, { name: 'quick-task' }], 'quick-task'],
    ['the first otherwise', [{ name: 'b' }, { name: 'a' }], 'b'],
    ['none from an empty catalog', [], undefined],
  ])('%s', (_, workflows, expected) => {
    expect(initialWorkflow(workflows)).toBe(expected)
  })
})

describe('initialModel', () => {
  const offered = [{ id: 'opus[1m]' }, { id: 'sonnet' }]
  it.each([
    ['the preset when offered', 'sonnet', 'sonnet'],
    ['Auto when the preset is not offered', 'gpt-5', undefined],
    ['Auto without a preset', undefined, undefined],
  ])('%s', (_, preset, expected) => {
    expect(initialModel(preset, offered)).toBe(expected)
  })
})

describe('discoversModels', () => {
  it.each([
    ['claude', true],
    ['codex', true],
    ['opencode', true],
    ['pi', false],
  ] as const)('%s → %s', (runner, expected) => {
    expect(discoversModels(runner)).toBe(expected)
  })
})

describe('profilesFor', () => {
  const profile = (id: string, provider: AgentProfile['provider']) => ({ id, provider, label: id }) as AgentProfile
  it("offers only the runner's own accounts", () => {
    const all = [profile('work', 'claude'), profile('oss', 'codex')]
    expect(profilesFor(all, 'claude').map((p) => p.id)).toEqual(['work'])
    expect(profilesFor(all, undefined)).toEqual([])
    expect(profilesFor(undefined, 'claude')).toEqual([])
  })
})

describe('createRunBody', () => {
  it('trims the task and leaves unset choices out', () => {
    expect(createRunBody({ task: '  fix it \n', workflow: 'quick-task', autonomous: false })).toEqual({
      task: 'fix it',
      workflow: 'quick-task',
      autonomous: false,
    })
  })

  it('carries every choice made', () => {
    expect(
      createRunBody({
        task: 'fix it',
        workflow: 'Ciey-issue-fix',
        runner: 'claude',
        model: 'sonnet',
        agentProfile: 'work',
        autonomous: true,
      }),
    ).toEqual({ task: 'fix it', workflow: 'Ciey-issue-fix', runner: 'claude', model: 'sonnet', agentProfile: 'work', autonomous: true })
  })

  it('never sends variants or dispatch', () => {
    const body = createRunBody({ task: 'x', workflow: 'quick-task', autonomous: false })
    expect(body).not.toHaveProperty('variants')
    expect(body).not.toHaveProperty('dispatch')
  })
})

describe('createdRunId — both arms of createRunResponseSchema', () => {
  it.each([
    ['one record', { id: 'a1b2c3d4', status: 'queued' }, 'a1b2c3d4'],
    ['a group opens its first run', { runs: [{ id: 'first' }, { id: 'second' }] }, 'first'],
    ['an empty group', { runs: [] }, undefined],
    ['neither shape', { ok: true }, undefined],
    ['not an object', null, undefined],
  ])('%s', (_, response, expected) => {
    expect(createdRunId(response)).toBe(expected)
  })
})
