interface AsyncStateProps {
  isLoading?: boolean;
  /** Only pass when the page already surfaces query errors today — adding it
      where errors were previously ignored would change behavior (e.g. a 401 on
      a protected query would replace the current "please sign in" fallback). */
  error?: unknown;
  /** True when the data resolved to an absent/empty state. */
  isEmpty?: boolean;
  loadingText?: string;
  errorText?: string;
  emptyText?: string;
}

/**
 * Loading / error / empty gate. Use it as an early return so TypeScript still
 * narrows the data afterwards, e.g.:
 *
 *   if (isLoading || error || !data)
 *     return <AsyncState isLoading={isLoading} error={error} isEmpty={!data} emptyText="Nothing here yet." />;
 *   // `data` is defined from here on
 */
export function AsyncState({
  isLoading = false,
  error,
  isEmpty = false,
  loadingText = "Loading...",
  errorText = "Something went wrong.",
  emptyText = "Nothing here yet.",
}: AsyncStateProps) {
  if (isLoading) return <p className="muted">{loadingText}</p>;
  if (error) {
    const message = error instanceof Error ? error.message : undefined;
    return <p className="muted">{message || errorText}</p>;
  }
  if (isEmpty) return <p className="muted">{emptyText}</p>;
  return null;
}
