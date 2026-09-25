import type { LimitCardModel, WindowRow } from '../../domain/limits.ts'
import { en } from '../../i18n/en.ts'

/** The bar's colour only repeats what its text already says (not colour alone, #93). */
function barColor(percent: number): string {
  if (percent >= 90) return 'bg-danger'
  if (percent >= 70) return 'bg-pending'
  return 'bg-accent'
}

function WindowLine({ row, cardKey }: { row: WindowRow; cardKey: string }) {
  const t = en.limits
  const labelId = `limit-${cardKey}-${row.key}`.replace(/[^a-zA-Z0-9_-]/g, '-')

  if (row.reading === undefined) {
    return (
      <li className="flex items-baseline justify-between gap-3 py-2 text-sm">
        <span id={labelId}>{row.label}</span>
        <span className="text-text-muted italic">{t.notReported}</span>
      </li>
    )
  }

  const { percent, reset } = row.reading
  return (
    <li className="flex flex-col gap-1 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId}>{row.label}</span>
        <span className="font-semibold tabular-nums">{t.used(percent)}</span>
      </div>
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t.used(percent)}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div className={`h-full rounded-full ${barColor(percent)}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-text-muted">{reset}</span>
    </li>
  )
}

/**
 * One provider × account (#93): a bar per window with its percentage in text, the reset
 * countdown and the reading's age. A reading older than 10 min has its numbers dimmed and says so; an
 * `unavailable` row shows the sidecar's reason instead of numbers.
 */
export function LimitCard({ card }: { card: LimitCardModel }) {
  const t = en.limits
  const titleId = `limit-card-${card.key}`.replace(/[^a-zA-Z0-9_-]/g, '-')
  const provider = t.provider[card.provider] ?? card.provider

  return (
    <li aria-labelledby={titleId} className="flex flex-col gap-1 rounded border border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="font-semibold break-words">
            {provider}
          </h3>
          <p className="text-sm break-words text-text-muted">{t.account(card.account)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
          {card.state === 'off' ? (
            <span className="font-semibold text-text-muted">{t.off}</span>
          ) : card.state === 'unavailable' ? (
            <span className="font-semibold text-danger">{t.unavailable}</span>
          ) : null}
          {card.stale ? <span className="rounded bg-surface-raised px-2 font-semibold text-pending">{t.stale}</span> : null}
        </div>
      </div>

      {card.reason ? <p className="text-sm break-words">{card.reason}</p> : null}

      {card.windows.length > 0 ? (
        // Stale: the numbers are dimmed, the word saying so is not.
        <ul className={`divide-y divide-border ${card.stale ? 'opacity-50' : ''}`}>
          {card.windows.map((row) => (
            <WindowLine key={row.key} row={row} cardKey={card.key} />
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-text-muted">
        {card.age ? t.read(card.age) : t.readUnknown}
        {card.stale ? ` · ${t.staleHint}` : ''}
      </p>
    </li>
  )
}
