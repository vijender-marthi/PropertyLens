import { Fragment, useMemo, useState } from 'react'
import { rawExportValue } from '../utils/formatters'

const ALIGN_CLASS = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

function defaultValue(row, column) {
  if (typeof column.accessor === 'function') return column.accessor(row)
  if (column.accessor) return row[column.accessor]
  return row[column.id]
}

function normalize(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return String(value).toLowerCase()
}

function compareValues(a, b, direction) {
  if (a === b) return 0
  if (a === '' || a === null || a === undefined) return direction === 'asc' ? 1 : -1
  if (b === '' || b === null || b === undefined) return direction === 'asc' ? -1 : 1
  const result = a > b ? 1 : -1
  return direction === 'asc' ? result : -result
}

function exportCsv(filename, columns, rows) {
  const escape = (value) => {
    const text = String(rawExportValue(value))
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const header = columns.map((column) => escape(column.header)).join(',')
  const body = rows
    .map((row) => columns.map((column) => escape(column.exportValue ? column.exportValue(row) : defaultValue(row, column))).join(','))
    .join('\n')
  const blob = new Blob([[header, body].filter(Boolean).join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function DataTable({
  columns,
  rows,
  getRowKey,
  emptyMessage = 'No records available.',
  defaultSort,
  controlledSort,
  onSortChange,
  manualSort = false,
  searchable = false,
  searchPlaceholder = 'Search',
  exportFilename,
  getRowProps,
  renderFullWidthRow,
  renderExpandedRow,
  tableWrapperClassName = 'overflow-auto',
  className = '',
}) {
  const [sort, setSort] = useState(defaultSort || null)
  const activeSort = controlledSort || sort
  const [search, setSearch] = useState('')

  const visibleColumns = useMemo(() => columns.filter((column) => !column.hidden), [columns])

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = query
      ? rows.filter((row) =>
          visibleColumns.some((column) => {
            const value = column.searchValue ? column.searchValue(row) : defaultValue(row, column)
            return String(value ?? '').toLowerCase().includes(query)
          }),
        )
      : [...rows]

    if (!sort) return filtered
    const column = visibleColumns.find((item) => item.id === sort.id)
    if (!column) return filtered
    return filtered.sort((left, right) => {
      const leftValue = normalize(column.sortValue ? column.sortValue(left) : defaultValue(left, column))
      const rightValue = normalize(column.sortValue ? column.sortValue(right) : defaultValue(right, column))
      return compareValues(leftValue, rightValue, sort.direction)
    })
  }, [rows, search, activeSort, manualSort, visibleColumns])

  const onSort = (column) => {
    if (column.sortable === false) return
    setSort((current) => {
      if (current?.id !== column.id) return { id: column.id, direction: column.defaultDirection || 'asc' }
      return { id: column.id, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    })
  }

  if (!rows.length) {
    return <div className="rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400 dark:border-gray-700">{emptyMessage}</div>
  }

  return (
    <div className={className}>
      {searchable || exportFilename ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {searchable ? (
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="min-w-48 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          ) : <span />}
          {exportFilename ? (
            <button
              type="button"
              onClick={() => exportCsv(exportFilename, visibleColumns, visibleRows)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Export current view
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={`${tableWrapperClassName} rounded-lg border border-gray-100 dark:border-gray-700`}>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700/80">
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
              {visibleColumns.map((column) => {
                const align = ALIGN_CLASS[column.align || 'left']
                const active = sort?.id === column.id
                const indicator = active ? (sort.direction === 'asc' ? '▲' : '▼') : ''
                return (
                  <th key={column.id} className={`px-3 py-2 font-medium ${align}`}>
                    <button
                      type="button"
                      onClick={() => onSort(column)}
                      className={`inline-flex w-full items-center gap-1 ${column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : 'justify-start'} ${column.sortable === false ? 'cursor-default' : 'hover:text-gray-900 dark:hover:text-white'}`}
                      disabled={column.sortable === false}
                    >
                      <span>{column.header}</span>
                      {indicator ? <span aria-hidden="true">{indicator}</span> : null}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700/60">
            {visibleRows.map((row, rowIndex) => {
              const rowKey = getRowKey ? getRowKey(row) : row.id ?? rowIndex
              const rowProps = getRowProps ? getRowProps(row, rowIndex) : {}
              const fullWidth = renderFullWidthRow ? renderFullWidthRow(row, rowIndex, visibleColumns) : null
              if (fullWidth) {
                return (
                  <tr
                    {...rowProps}
                    key={rowKey}
                    className={rowProps.className || 'bg-gray-50 dark:bg-gray-800/50'}
                  >
                    <td colSpan={visibleColumns.length} className={rowProps.cellClassName || 'px-3 py-2'}>{fullWidth}</td>
                  </tr>
                )
              }
              return (
                <Fragment key={rowKey}>
                  <tr
                    {...rowProps}
                    className={rowProps.className || 'odd:bg-white even:bg-gray-50/40 hover:bg-gray-50 dark:odd:bg-transparent dark:even:bg-gray-800/20 dark:hover:bg-gray-700/40'}
                  >
                    {visibleColumns.map((column) => {
                      const align = ALIGN_CLASS[column.align || 'left']
                      const value = defaultValue(row, column)
                      return (
                        <td key={column.id} className={`px-3 py-2 ${align} ${column.cellClassName || 'text-gray-700 dark:text-gray-200'}`}>
                          {column.render ? column.render(row, value) : value ?? '—'}
                        </td>
                      )
                    })}
                  </tr>
                  {renderExpandedRow && renderExpandedRow(row, rowIndex, visibleColumns) ? (
                    <tr className="bg-blue-50/40 dark:bg-blue-950/10">
                      <td colSpan={visibleColumns.length} className="border-b border-gray-100 px-3 py-3 dark:border-gray-800">
                        {renderExpandedRow(row, rowIndex, visibleColumns)}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
