import { readFileSync } from 'node:fs'

/** Fixtures for the limits tests (`test/fixtures/limits/`). Not imported by `index.ts`. */
export const FIXTURES = new URL('../../test/fixtures/limits/', import.meta.url)

export const fixturePath = (name: string) => new URL(name, FIXTURES).pathname

export const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'))

/** The fake login's secrets: no response and no log line may ever contain them. */
export const FIXTURE_TOKEN = 'sk-ant-oat01-FIXTURE-TOKEN-must-never-leak'
export const FIXTURE_REFRESH = 'sk-ant-ort01-FIXTURE-REFRESH-must-never-leak'
