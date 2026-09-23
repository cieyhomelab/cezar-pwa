import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en.ts'
import { InstallHint } from './InstallHint.tsx'

describe('InstallHint', () => {
  it('tells the operator how to install, since iOS offers no prompt (FR-001)', () => {
    render(<InstallHint standalone={false} />)
    expect(screen.getByText(en.install.title)).toBeInTheDocument()
    expect(screen.getByText(en.install.ios)).toBeInTheDocument()
  })

  it('says nothing once the app runs from the icon', () => {
    render(<InstallHint standalone />)
    expect(screen.queryByText(en.install.title)).not.toBeInTheDocument()
  })

  it('can be dismissed for the session', () => {
    render(<InstallHint standalone={false} />)

    fireEvent.click(screen.getByRole('button', { name: en.install.dismiss }))
    expect(screen.queryByText(en.install.title)).not.toBeInTheDocument()
  })
})
