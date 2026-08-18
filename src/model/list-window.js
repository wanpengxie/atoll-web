export const LIST_WINDOW_SIZE = 120;

export function boundedPage(items, page = 0, size = LIST_WINDOW_SIZE) {
  const values = Array.isArray(items) ? items : [];
  const windowSize = Math.max(1, Math.floor(Number(size) || LIST_WINDOW_SIZE));
  const pageCount = Math.max(1, Math.ceil(values.length / windowSize));
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pageCount - 1);
  const end = Math.max(0, values.length - safePage * windowSize);
  const start = Math.max(0, end - windowSize);
  return {
    items: values.slice(start, end),
    page: safePage,
    pageCount,
    start,
    end,
    total: values.length,
    hasOlder: start > 0,
    hasNewer: end < values.length,
  };
}
