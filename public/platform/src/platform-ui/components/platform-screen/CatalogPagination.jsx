import React, { useEffect, useState } from "react";
import styles from "./GameLibrary.module.scss";

/** Provide previous/next and direct page navigation without building thousands of page buttons. */
export default function CatalogPagination({ page, totalPages, loading, onPageChange }) {
  const [pageDraft, setPageDraft] = useState(String(page));
  useEffect(() => setPageDraft(String(page)), [page]);

  function submitPage(event) {
    event.preventDefault();
    const requestedPage = Number(pageDraft);
    if (Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= totalPages) {
      onPageChange(requestedPage);
    } else {
      setPageDraft(String(page));
    }
  }

  return (
    <nav className={styles.catalogPagination} aria-label="Catalog pages">
      <button type="button" onClick={() => onPageChange(page - 1)} disabled={loading || page <= 1} aria-label="Previous page">
        <span aria-hidden="true">←</span><span>Previous</span>
      </button>
      <form className={styles.pageJump} onSubmit={submitPage}>
        <label>Page
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={totalPages}
            step={1}
            value={pageDraft}
            onChange={(event) => setPageDraft(event.target.value)}
            aria-label="Page number"
            disabled={loading}
          />
        </label>
        <span>of {totalPages.toLocaleString()}</span>
        <button type="submit" aria-label="Go to page" disabled={loading} title="Go to page">↵</button>
      </form>
      <button type="button" onClick={() => onPageChange(page + 1)} disabled={loading || page >= totalPages} aria-label="Next page">
        <span>Next</span><span aria-hidden="true">→</span>
      </button>
    </nav>
  );
}
