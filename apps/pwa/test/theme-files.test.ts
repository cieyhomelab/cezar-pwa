/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_COLOR } from '../src/domain/theme.ts'

/**
 * S-12 (FR-046): the theme lives in three files that nothing ties together — the palettes in
 * `index.css`, the status-bar colours in `index.html` and `THEME_COLOR`, which `pwa/theme.ts`
 * writes into those tags when a theme is forced. Read from disk: under Vitest a `?raw` CSS import
 * comes back empty, because CSS is not processed.
 */
const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8')
const css = readFileSync(resolve(import.meta.dirname, '../src/index.css'), 'utf8')

describe('THEME_COLOR', () => {
  it('matches the theme-color tags in index.html', () => {
    expect(html).toContain(`media="(prefers-color-scheme: light)" content="${THEME_COLOR.light}"`)
    expect(html).toContain(`media="(prefers-color-scheme: dark)" content="${THEME_COLOR.dark}"`)
  })

  it('matches each palette’s surface in index.css', () => {
    const surfaces = [...css.matchAll(/--surface: (#[0-9a-f]{6});/g)].map((match) => match[1])
    expect(new Set(surfaces)).toEqual(new Set([THEME_COLOR.dark, THEME_COLOR.light]))
  })
})

describe('index.css', () => {
  /** The declarations of the first rule whose selector is `selector`, in order. */
  const declarations = (selector: string) => {
    const start = css.indexOf(`${selector} {`)
    expect(start).toBeGreaterThan(-1)
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
    return body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .map((line: string) => line.trim())
      .filter((line: string) => line.startsWith('--'))
  }

  it('gives a forced light theme exactly the system light palette', () => {
    const system = declarations(":root:not([data-theme='dark'])")
    expect(system.length).toBeGreaterThan(5)
    expect(declarations(":root[data-theme='light']")).toEqual(system)
  })
})
