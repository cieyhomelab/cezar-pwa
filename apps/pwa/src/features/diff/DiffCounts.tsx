import { en } from '../../i18n/en.ts'

/** "+12 −3" on screen, the same in words for a screen reader. The sign carries it, not the colour. */
export function DiffCounts({ adds, dels }: { adds: number; dels: number }) {
  return (
    <span className="font-mono text-xs whitespace-nowrap">
      <span aria-hidden="true">
        <span className="text-success">+{adds}</span> <span className="text-danger">−{dels}</span>
      </span>
      <span className="sr-only">{en.run.diff.countsLabel(adds, dels)}</span>
    </span>
  )
}
