import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { en } from '../../i18n/en.ts'

/**
 * One of a run's persisted images (#65): a tappable thumbnail that opens full-screen. `src` is the
 * project-scoped route (`run-images.ts`). Without one, or once the image fails to load, it falls
 * back to the text line the transcript showed before.
 *
 * The full-screen view is portalled to `<body>`: the thumbnail can sit inside the sticky composer,
 * and nothing in the run screen should clip or re-stack it.
 */
export function RunImage({ src, name, size = 'large' }: { src?: string; name?: string; size?: 'large' | 'small' }) {
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const t = en.run.transcript.images

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (src === undefined || failed) return <p className="text-sm text-text-muted">{en.run.transcript.image(name)}</p>

  const fail = () => {
    setOpen(false)
    setFailed(true)
  }
  const label = name ?? t.alt

  return (
    <>
      <button
        type="button"
        className="touch-target self-start rounded"
        aria-label={t.open(name)}
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={label}
          loading="lazy"
          decoding="async"
          onError={fail}
          className={`${size === 'small' ? 'max-h-16 max-w-24' : 'max-h-48 max-w-full'} rounded border border-border bg-surface-raised object-contain`}
        />
      </button>
      {open
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={label}
              className="fixed inset-0 z-50 flex flex-col bg-black pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
              onClick={() => setOpen(false)}
            >
              <div className="flex justify-end px-2">
                <button
                  type="button"
                  className="touch-target rounded px-4 font-semibold text-white"
                  onClick={() => setOpen(false)}
                  autoFocus
                >
                  {t.close}
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center p-2">
                <img src={src} alt={label} onError={fail} className="max-h-full max-w-full object-contain" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
