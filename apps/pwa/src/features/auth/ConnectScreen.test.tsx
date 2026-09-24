import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../../i18n/en.ts'
import { ConnectScreen } from './ConnectScreen.tsx'

const ORIGIN = 'https://cezar.example.test'

function setup(props: Partial<Parameters<typeof ConnectScreen>[0]> = {}) {
  const navigate = vi.fn()
  const onRecheck = vi.fn()
  render(
    <ConnectScreen
      origin={ORIGIN}
      navigate={navigate}
      onRecheck={onRecheck}
      isProbing={false}
      {...props}
    />,
  )
  return { navigate, onRecheck }
}

function paste(value: string) {
  fireEvent.change(screen.getByLabelText(en.auth.linkLabel), { target: { value } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: en.auth.submit }))
}

describe('ConnectScreen', () => {
  it('explains that this is not a login', () => {
    setup()
    expect(screen.getByRole('heading', { name: en.auth.title })).toBeInTheDocument()
    expect(screen.getByText(en.auth.intro)).toBeInTheDocument()
    expect(screen.getByText(en.auth.privacy)).toBeInTheDocument()
  })

  it('shows its own host as the example link, not a fixed deployment (#27)', () => {
    setup()
    expect(screen.getByLabelText(en.auth.linkLabel)).toHaveAttribute('placeholder', `${ORIGIN}/…?key=…`)
  })

  it('sends a pasted access link to the gateway at the app’s own path (FR-005)', () => {
    const { navigate } = setup()
    paste(`${ORIGIN}/?key=s3cret`)
    submit()
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/m/?key=s3cret`)
  })

  it('clears the pasted secret from the field once it is handed over', () => {
    setup()
    paste(`${ORIGIN}/?key=s3cret`)
    submit()
    expect(screen.getByLabelText(en.auth.linkLabel)).toHaveValue('')
  })

  it.each([
    ['', en.auth.errors.empty],
    ['https://evil.example/?key=s3cret', en.auth.errors.foreignOrigin],
    [`${ORIGIN}/m/`, en.auth.errors.missingKey],
    ['javascript:alert(1)', en.auth.errors.notAUrl],
  ])('refuses to navigate with %s and says why', (value, message) => {
    const { navigate } = setup()
    if (value !== '') paste(value)
    submit()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('clears the error as soon as the operator types again', () => {
    setup()
    submit()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    paste('h')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sends a pasted base64 key through unaltered, since nginx compares raw bytes', () => {
    const { navigate } = setup()
    paste(`${ORIGIN}/?key=Zm9v/YmFy+cXV4==`)
    submit()
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/m/?key=Zm9v/YmFy+cXV4==`)
  })

  it('in the installed app, points at the server rather than at Safari when the key was ignored', () => {
    // The installed app keeps its own cookies (R-AUTH-1): a session opened in
    // Safari never reaches it, so advising that would be a dead end.
    setup({ unlockFailed: true, standalone: true })
    expect(screen.getByText(en.auth.unlockFailed)).toBeInTheDocument()
    expect(screen.getByText(en.auth.unlockFailedServer)).toBeInTheDocument()
    expect(screen.queryByText(en.auth.manualTab)).not.toBeInTheDocument()
    expect(screen.queryByText(/Safari/)).not.toBeInTheDocument()
  })

  it('in a browser tab, offers opening the link directly, once', () => {
    setup({ unlockFailed: true, standalone: false })
    expect(screen.getByText(en.auth.unlockFailed)).toBeInTheDocument()
    expect(screen.getAllByText(en.auth.manualTab)).toHaveLength(1)
  })

  it('never offers the browser route inside the installed app', () => {
    setup({ standalone: true })
    expect(screen.queryByText(en.auth.manualTab)).not.toBeInTheDocument()
  })

  it('keeps quiet about the gateway when nothing has been tried yet', () => {
    setup()
    expect(screen.queryByText(en.auth.unlockFailed)).not.toBeInTheDocument()
  })

  it('re-probes the session on request', () => {
    const { onRecheck } = setup()
    fireEvent.click(screen.getByRole('button', { name: en.auth.recheck }))
    expect(onRecheck).toHaveBeenCalled()
  })

  it('says a probe is running rather than accepting a second one', () => {
    setup({ isProbing: true })
    expect(screen.getByRole('button', { name: en.auth.rechecking })).toBeDisabled()
  })

  it('keeps the browser from remembering or mangling the secret', () => {
    setup()
    const input = screen.getByLabelText(en.auth.linkLabel)
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('autocapitalize', 'none')
    expect(input).toHaveAttribute('spellcheck', 'false')
  })
})
