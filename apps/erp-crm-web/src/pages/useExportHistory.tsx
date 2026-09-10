import { useCallback, useEffect, useState } from 'react';
import { Button } from '@vista/ui';
import { exportHistoryText as text } from './export-history.messages';
import './export-history.css';

export function useExportHistory<T extends { status: string }>(
  token: string,
  fetchPage: (
    token: string,
    page: number,
    pageSize: number,
  ) => Promise<{ items: T[]; totalPages: number }>,
) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<{
    items: T[];
    totalPages: number;
    page: number;
    token: string;
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => setPage(1), [token]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void fetchPage(token, page, 6)
      .then((result) => {
        if (!active) return;
        if (page > Math.max(1, result.totalPages)) {
          setPage(Math.max(1, result.totalPages));
          return;
        }
        setData({ ...result, page, token });
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, fetchPage, page, revision]);
  useEffect(() => {
    if (
      loading ||
      error ||
      !data?.items.some((item) => ['queued', 'processing'].includes(item.status))
    )
      return;
    const timer = window.setTimeout(() => setRevision((value) => value + 1), 2000);
    return () => window.clearTimeout(timer);
  }, [data, loading, error]);
  const refresh = useCallback((firstPage = false) => {
    if (firstPage) setPage(1);
    setRevision((value) => value + 1);
  }, []);
  const pending = loading || data?.page !== page || data?.token !== token;
  return {
    items: !error && data?.page === page && data.token === token ? data.items : [],
    page,
    pages: data?.totalPages ?? 0,
    loading: pending && !error,
    showLoading: pending && !error && (data?.page !== page || data?.token !== token),
    error,
    refresh,
    setPage,
  };
}

export function ExportHistoryControls({
  history,
}: {
  history: Pick<
    ReturnType<typeof useExportHistory>,
    'page' | 'pages' | 'loading' | 'showLoading' | 'error' | 'setPage'
  >;
}) {
  return (
    <>
      {history.error ? (
        <p role="alert">{text.error}</p>
      ) : history.showLoading ? (
        <p role="status">{text.loading}</p>
      ) : null}
      {history.pages > 1 ? (
        <nav className="registry-pagination export-history-pagination" aria-label={text.label}>
          <Button
            variant="secondary"
            disabled={history.loading || history.page <= 1}
            onClick={() => history.setPage((p) => p - 1)}
          >
            {text.previous}
          </Button>
          <span>{text.page(history.page, history.pages)}</span>
          <Button
            variant="secondary"
            disabled={history.loading || history.page >= history.pages}
            onClick={() => history.setPage((p) => p + 1)}
          >
            {text.next}
          </Button>
        </nav>
      ) : null}
    </>
  );
}
