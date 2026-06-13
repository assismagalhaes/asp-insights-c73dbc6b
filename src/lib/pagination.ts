import { useMemo, useState } from "react";

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export function useClientPagination<T>(rows: T[], initialPageSize: PageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(initialPageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);

  const setPageSizeAndReset = (next: PageSize) => {
    setPageSize(next);
    setPage(1);
  };

  return {
    page: safePage,
    pageSize,
    totalPages,
    totalRows: rows.length,
    paginatedRows,
    setPage,
    setPageSize: setPageSizeAndReset,
  };
}
