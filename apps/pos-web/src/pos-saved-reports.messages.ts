import { bg } from './i18n/catalog';
import { getPosLocale } from './i18n/LocalizationProvider';

const englishSavedReportText = {
  title: 'Saved reports & export fields',
  saved: 'My saved reports',
  open: 'Open a saved report',
  empty: 'No saved reports yet',
  fields: 'Fields to include in the file',
  name: 'Report name',
  format: 'File type',
  save: 'Save as new report',
  export: 'Prepare export',
  success: 'Report saved. Open it again from My saved reports.',
  restored: 'Saved report opened. Filters and export fields have been restored.',
  invalid: 'Choose at least one field.',
  previous: 'Previous',
  next: 'Next',
  unavailable: 'This saved report is no longer available.',
  hint: 'Saved options use the applied filters above. The on-screen table keeps all its columns.',
} as const;

const englishExportHistoryText = {
  title: 'Recent exports',
  owner: 'Only reports requested from this account are shown.',
  refresh: 'Refresh',
  loading: 'Loading your files…',
  error: 'Your files could not be loaded. Select Refresh to try again.',
  empty: 'Your prepared files will appear here.',
  previous: 'Previous exports',
  next: 'Next exports',
  page: (page: number, pages: number) => `Page ${page} of ${Math.max(1, pages)}`,
} as const;

function localized<T extends object>(english: T): T {
  return new Proxy(english, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (getPosLocale() !== 'bg') return value;
      if (typeof value === 'string') return bg(value);
      if (property === 'page')
        return (page: number, pages: number) => `Страница ${page} от ${Math.max(1, pages)}`;
      return value;
    },
  });
}

export const savedReportText = localized(englishSavedReportText);
export const exportHistoryText = localized(englishExportHistoryText);
