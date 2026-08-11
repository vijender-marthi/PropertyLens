// Lightweight, dependency-free markdown renderer for AI Coach replies. Builds
// React elements directly (never dangerouslySetInnerHTML), so all text is escaped
// by React. Supports headings, ordered/unordered lists, tables, blockquotes,
// horizontal rules, and inline **bold** / *italic* / `code`. Styled with colors
// to match the app.

function renderInline(text, keyPrefix) {
  const nodes = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g
  let last = 0
  let m
  let i = 0
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-${i}`
    if (tok.startsWith('**')) {
      nodes.push(<strong key={key} className="font-semibold text-gray-900 dark:text-white">{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      nodes.push(<code key={key} className="rounded bg-gray-200/80 px-1 py-0.5 font-mono text-[0.85em] text-blue-700 dark:bg-gray-700 dark:text-blue-200">{tok.slice(1, -1)}</code>)
    } else {
      nodes.push(<em key={key} className="italic text-gray-700 dark:text-gray-200">{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderTable(tblLines, key) {
  const rows = tblLines.map((l) =>
    l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  )
  if (rows.length < 2) return null
  const header = rows[0]
  const body = rows.slice(2) // row 1 is the |---|---| separator
  return (
    <div key={key} className="my-2 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {header.map((c, k) => (
              <th key={k} className="border-b border-gray-200 bg-blue-50 px-2.5 py-1.5 text-left font-semibold text-blue-800 dark:border-gray-700 dark:bg-blue-950/40 dark:text-blue-200">
                {renderInline(c, `${key}-th-${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="even:bg-gray-50/70 dark:even:bg-gray-800/40">
              {header.map((_, ci) => (
                <td key={ci} className="border-b border-gray-100 px-2.5 py-1.5 tabular-nums text-gray-700 last:border-b-0 dark:border-gray-800 dark:text-gray-300">
                  {renderInline(r[ci] ?? '', `${key}-td-${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const BLOCK_START = /^(#{1,4}\s|\s*[-*+]\s|\s*\d+\.\s|\s*>\s?|\s*\|)/

export default function MarkdownMessage({ content }) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let seq = 0
  const nextKey = () => `b${seq++}`
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i++; continue }

    // Heading
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      const size = level <= 1 ? 'text-base' : level === 2 ? 'text-[15px]' : 'text-sm'
      const k = nextKey()
      blocks.push(
        <div key={k} className={`mt-2.5 flex items-center gap-2 font-semibold text-blue-700 first:mt-0 dark:text-blue-300 ${size}`}>
          <span className="inline-block h-3.5 w-1 rounded-full bg-blue-500" aria-hidden="true" />
          {renderInline(h[2], k)}
        </div>
      )
      i++
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={nextKey()} className="my-2 border-gray-200 dark:border-gray-700" />)
      i++
      continue
    }

    // Table (header row followed by a |---|---| separator)
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const tbl = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { tbl.push(lines[i]); i++ }
      const t = renderTable(tbl, nextKey())
      if (t) blocks.push(t)
      continue
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      const k = nextKey()
      blocks.push(
        <ul key={k} className="my-1 space-y-1">
          {items.map((it, idx) => (
            <li key={idx} className="flex gap-2 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
              <span className="min-w-0">{renderInline(it, `${k}-${idx}`)}</span>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      const k = nextKey()
      blocks.push(
        <ol key={k} className="my-1 space-y-1.5">
          {items.map((it, idx) => (
            <li key={idx} className="flex gap-2 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">{idx + 1}</span>
              <span className="min-w-0 pt-0.5">{renderInline(it, `${k}-${idx}`)}</span>
            </li>
          ))}
        </ol>
      )
      continue
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      const k = nextKey()
      blocks.push(
        <blockquote key={k} className="my-1 rounded-r border-l-2 border-blue-300 bg-blue-50/50 py-1 pl-3 text-sm italic text-gray-600 dark:border-blue-700 dark:bg-blue-950/20 dark:text-gray-300">
          {renderInline(quote.join(' '), k)}
        </blockquote>
      )
      continue
    }

    // Paragraph
    const para = [line]
    i++
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
      para.push(lines[i])
      i++
    }
    const k = nextKey()
    blocks.push(
      <p key={k} className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">{renderInline(para.join(' '), k)}</p>
    )
  }

  return <div className="space-y-1.5 text-left">{blocks}</div>
}
