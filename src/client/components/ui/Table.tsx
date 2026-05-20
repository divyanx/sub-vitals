// src/client/components/ui/Table.tsx
import type React from 'react';

export interface Column<T> {
  key: string;
  header: string;
  /** Whether clicking the header triggers sort. */
  sortable?: boolean;
  /** Render cell content. Receives the row datum. */
  render: (row: T) => React.ReactNode;
  /** Hide on small screens (<md). */
  hideOnMobile?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  emptyMessage?: string;
}

export function Table<T>({
  columns,
  rows,
  getRowKey,
  sortKey,
  sortDir = 'asc',
  onSort,
  emptyMessage = 'No data.',
}: TableProps<T>) {
  return (
    <div className="w-full overflow-x-auto rounded-[var(--r-3)] border border-[var(--n-4)]">
      <table className="w-full text-[length:var(--t-sm)] text-[var(--n-11)]">
        <thead className="border-b border-[var(--n-4)] bg-[var(--n-2)]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={[
                  'px-4 py-3 text-left font-medium text-[var(--n-8)] whitespace-nowrap',
                  col.hideOnMobile ? 'hidden md:table-cell' : '',
                  col.sortable ? 'cursor-pointer select-none hover:text-[var(--n-11)]' : '',
                ].join(' ')}
                onClick={col.sortable && onSort ? () => onSort(col.key) : undefined}
                aria-sort={
                  sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key ? (
                    <svg
                      aria-hidden="true"
                      className={`h-3 w-3 transition-transform ${sortDir === 'desc' ? 'rotate-180' : ''}`}
                      viewBox="0 0 12 12"
                      fill="currentColor"
                    >
                      <path d="M6 2l4 5H2z" />
                    </svg>
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--n-3)] bg-[var(--n-1)]">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-[var(--n-7)]">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)} className="transition-colors hover:bg-[var(--n-3)]">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={['px-4 py-3', col.hideOnMobile ? 'hidden md:table-cell' : ''].join(
                      ' ',
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
