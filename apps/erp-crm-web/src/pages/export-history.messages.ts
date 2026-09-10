export const exportHistoryText = {
  loading: 'Loading your files…',
  error: 'Your files could not be loaded. Select Refresh to try again.',
  previous: 'Previous exports',
  next: 'Next exports',
  label: 'Export history pages',
  page: (page: number, pages: number) => `Page ${page} of ${Math.max(1, pages)}`,
};
