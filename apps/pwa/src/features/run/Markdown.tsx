import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { en } from '../../i18n/en.ts'

/**
 * Agent markdown as text (FR-017, NF "content produced by an agent never executes").
 *
 * - No raw HTML: `react-markdown` renders HTML in markdown as text unless `rehype-raw` is added,
 *   and it is not. There is no `dangerouslySetInnerHTML` anywhere (CLAUDE.md).
 * - No dangerous URLs: the default `urlTransform` drops `javascript:`, `data:` and friends.
 * - No loading: a markdown image becomes its alt text. An `<img>` pointing wherever the agent
 *   chose would be a request to a third party (PRD: no third-party services).
 * - Links leave the app in a new tab and carry no referrer.
 *
 * GFM for tables, strikethrough and task lists, which agents write constantly. No syntax
 * highlighting (PRD non-goal).
 */
const components: Components = {
  img: ({ alt }) => (
    <span className="text-text-muted">[{alt || en.run.transcript.markdownImageAlt}]</span>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded bg-surface-raised p-2 text-xs leading-snug">{children}</pre>
  ),
  code: ({ className, children }) => (
    <code className={`${className ?? ''} rounded bg-surface-raised px-1 text-[0.85em]`}>{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-2 py-1 text-left">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
  ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
  p: ({ children }) => <p className="my-1.5">{children}</p>,
  h1: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-text-muted">{children}</blockquote>
  ),
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
