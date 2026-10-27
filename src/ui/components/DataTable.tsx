"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Skeleton } from "./basics";
import { Popover } from "./overlays";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Makes the column sortable; the value to compare. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Text used by the filter box; defaults to the sort value. */
  filterText?: (row: T) => string;
  /** Hidden until the person turns it on in "Columns". */
  hiddenByDefault?: boolean;
  /** Cannot be hidden (the name column). */
  alwaysVisible?: boolean;
  align?: "left" | "right";
}

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export interface DataTableProps<T> {
  /** The table's accessible name. */
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** The row's name for screen readers ("Select Wafula Ltd"). */
  rowLabel?: (row: T) => string;
  loading?: boolean;
  /** Shown when there are no rows at all (the empty state with its next action). */
  empty?: ReactNode;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  /** Why a row cannot be selected (a read-only record): shown, not hidden. */
  rowDisabledReason?: (row: T) => string | undefined;
  bulkActions?: (rows: T[]) => ReactNode;
  filterable?: boolean;
  filterLabel?: string;
  onRowClick?: (row: T) => void;
  maxHeight?: number | string;
}

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The one table every list is built from: sort, filter, bulk select, a sticky header, column visibility and density (the root density mode
 * sets the row padding). Sorting and filtering run in the browser for the rows given; a server-paged list passes `sort` and `onSortChange`
 * to sort on the server instead and does its own filtering.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  rowLabel,
  loading,
  empty,
  sort: controlledSort,
  onSortChange,
  selectable,
  selected,
  onSelectedChange,
  rowDisabledReason,
  bulkActions,
  filterable,
  filterLabel = "Filter rows",
  onRowClick,
  maxHeight,
}: DataTableProps<T>) {
  const [innerSort, setInnerSort] = useState<SortState>(null);
  const sort = controlledSort !== undefined ? controlledSort : innerSort;
  const [innerSelected, setInnerSelected] = useState<Set<string>>(new Set());
  const sel = selected ?? innerSelected;
  const [filter, setFilter] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.hiddenByDefault).map((c) => c.key)));

  const visible = columns.filter((c) => c.alwaysVisible || !hidden.has(c.key));

  const processed = useMemo(() => {
    let list = rows;
    const q = filter.trim().toLowerCase();
    if (q) {
      list = list.filter((row) =>
        columns.some((c) => {
          const text = c.filterText ? c.filterText(row) : c.sortValue ? String(c.sortValue(row) ?? "") : "";
          return text.toLowerCase().includes(q);
        }),
      );
    }
    if (sort && onSortChange === undefined) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortValue) {
        const dir = sort.dir === "asc" ? 1 : -1;
        list = [...list].sort((a, b) => dir * compare(col.sortValue!(a), col.sortValue!(b)));
      }
    }
    return list;
  }, [rows, filter, sort, columns, onSortChange]);

  const selectableRows = processed.filter((r) => !rowDisabledReason?.(r));
  const selectedRows = rows.filter((r) => sel.has(rowKey(r)));
  const allChecked = selectableRows.length > 0 && selectableRows.every((r) => sel.has(rowKey(r)));
  const someChecked = !allChecked && selectableRows.some((r) => sel.has(rowKey(r)));
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChecked;
  }, [someChecked]);

  function setSelected(next: Set<string>) {
    if (onSelectedChange) onSelectedChange(next);
    else setInnerSelected(next);
  }
  function toggleSort(key: string) {
    const next: SortState = !sort || sort.key !== key ? { key, dir: "asc" } : sort.dir === "asc" ? { key, dir: "desc" } : null;
    if (onSortChange) onSortChange(next);
    else setInnerSort(next);
  }

  const colSpan = visible.length + (selectable ? 1 : 0);
  return (
    <div>
      {filterable || columns.some((c) => !c.alwaysVisible) ? (
        <div className="fb-table__tools">
          {filterable ? (
            <input
              type="search"
              className="fb-input"
              style={{ maxWidth: 280 }}
              aria-label={filterLabel}
              placeholder={filterLabel}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          ) : null}
          <span style={{ marginLeft: "auto" }}>
            <Popover label="Choose columns" trigger="Columns" triggerClassName="fb-btn fb-btn--secondary fb-btn--sm" align="end">
              <fieldset style={{ border: 0, margin: 0, padding: 8 }}>
                <legend className="fb-sr-only">Visible columns</legend>
                {columns
                  .filter((c) => !c.alwaysVisible)
                  .map((c) => (
                    <label key={c.key} className="fb-check" style={{ display: "flex" }}>
                      <input
                        type="checkbox"
                        checked={!hidden.has(c.key)}
                        onChange={(e) => {
                          const next = new Set(hidden);
                          if (e.target.checked) next.delete(c.key);
                          else next.add(c.key);
                          setHidden(next);
                        }}
                      />
                      <span>{c.header}</span>
                    </label>
                  ))}
              </fieldset>
            </Popover>
          </span>
        </div>
      ) : null}

      {selectable && selectedRows.length > 0 ? (
        <div className="fb-table__bulk" role="region" aria-label="Bulk actions">
          <span aria-live="polite">{selectedRows.length} selected</span>
          {bulkActions?.(selectedRows)}
          <button type="button" className="fb-btn fb-btn--ghost fb-btn--sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="fb-tablewrap" style={maxHeight ? ({ "--fb-table-max": typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight } as React.CSSProperties) : undefined}>
        <table className="fb-table" aria-busy={loading || undefined}>
          <caption className="fb-sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable ? (
                <th style={{ width: 40 }}>
                  <input
                    ref={allRef}
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={allChecked}
                    disabled={selectableRows.length === 0}
                    onChange={(e) => {
                      const next = new Set(sel);
                      for (const r of selectableRows) {
                        if (e.target.checked) next.add(rowKey(r));
                        else next.delete(rowKey(r));
                      }
                      setSelected(next);
                    }}
                  />
                </th>
              ) : null}
              {visible.map((c) => {
                const dir = sort?.key === c.key ? sort.dir : null;
                return (
                  <th key={c.key} scope="col" style={{ textAlign: c.align ?? "left" }} aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : c.sortValue ? "none" : undefined}>
                    {c.sortValue ? (
                      <button type="button" className="fb-sort" onClick={() => toggleSort(c.key)}>
                        {c.header}
                        <span aria-hidden="true">{dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}</span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={`s${i}`}>
                    {Array.from({ length: colSpan }, (_, j) => (
                      <td key={j}>
                        <Skeleton width={j === 0 ? "70%" : "50%"} />
                      </td>
                    ))}
                  </tr>
                ))
              : processed.map((row) => {
                  const key = rowKey(row);
                  const reason = rowDisabledReason?.(row);
                  const isSelected = sel.has(key);
                  return (
                    <tr
                      key={key}
                      data-selected={isSelected ? "true" : undefined}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      style={onRowClick ? { cursor: "pointer" } : undefined}
                    >
                      {selectable ? (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${rowLabel ? rowLabel(row) : key}`}
                            title={reason}
                            disabled={Boolean(reason)}
                            checked={isSelected}
                            onChange={(e) => {
                              const next = new Set(sel);
                              if (e.target.checked) next.add(key);
                              else next.delete(key);
                              setSelected(next);
                            }}
                          />
                          {reason ? <span className="fb-sr-only">{reason}</span> : null}
                        </td>
                      ) : null}
                      {visible.map((c) => (
                        <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {!loading && processed.length === 0 ? (
          <div style={{ padding: 16 }}>{rows.length === 0 ? empty : <span className="fb-help">No rows match that filter.</span>}</div>
        ) : null}
      </div>
    </div>
  );
}
