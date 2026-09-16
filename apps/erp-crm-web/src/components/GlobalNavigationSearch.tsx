import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useLocalization } from '../i18n/LocalizationProvider';
import { localizeModule, moduleLabel, navigationGroupLabel } from '../i18n/navigation';
import { allModuleItems, navigationGroups } from '../navigation';
import { localizeWorkflowPage, workflowPages, workflowPath } from '../pages/workflow-pages';
import { useRouter } from '../routing/Router';
import { Icon, type IconName } from './Icon';

interface SearchDestination {
  description: string;
  group: string;
  icon: IconName;
  keywords?: string;
  label: string;
  module?: string;
  path: string;
  permission?: string;
}

export function GlobalNavigationSearch() {
  const { hasPermission } = useAuth();
  const { locale, t } = useLocalization();
  const { location, navigate } = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const destinations = useMemo(() => {
    const groupByPath = new Map(
      navigationGroups.flatMap((group) => group.modules.map((item) => [item.path, group.label])),
    );
    const moduleDestinations: SearchDestination[] = allModuleItems
      .filter((item) => hasPermission(item.key))
      .map((item) => localizeModule(item, t))
      .map((item) => ({
        description: item.description,
        group: navigationGroupLabel(groupByPath.get(item.path) ?? 'Workspace', t),
        icon: item.icon,
        keywords: `${item.key.replaceAll('.', ' ')} ${item.label}`,
        label: item.label,
        module: item.key,
        path: item.path,
      }));
    const workflowDestinations: SearchDestination[] = workflowPages
      .filter(
        (page) =>
          hasPermission(page.module) &&
          (page.module !== 'erp.service' ||
            page.slug !== 'reports' ||
            hasPermission('erp.service', 'approve')),
      )
      .map(localizeWorkflowPage)
      .map((page) => ({
        description: page.description,
        group: moduleGroup(page.module, t),
        icon: page.icon,
        keywords: `${page.action} ${page.sections.flatMap((section) => section.items).join(' ')}`,
        label: page.title,
        module: page.module,
        path: workflowPath(page),
      }));
    const utilityDestinations: SearchDestination[] = [
      {
        description: t('search.overviewDescription'),
        group: t('navigation.workspace'),
        icon: 'home',
        keywords: 'home dashboard start начало табло',
        label: t('navigation.overview'),
        path: '/',
      },
      {
        description: t('search.accountDescription'),
        group: t('search.account'),
        icon: 'profile',
        keywords: 'profile password two factor 2fa security профил парола сигурност',
        label: t('account.myAccess'),
        path: '/access',
      },
    ];
    const directDestinations: SearchDestination[] = [
      {
        description: t('search.partnerDescription'),
        group: t('navigation.crm'),
        icon: 'customers',
        keywords: 'customer supplier business partner contact equipment клиент доставчик партньор',
        label: t('search.partnerRegistry'),
        module: 'crm',
        path: '/partners',
      },
      {
        description: t('search.productDescription'),
        group: `${t('navigation.erp')} · ${t('navigation.warehouse')}`,
        icon: 'warehouse',
        keywords: 'product unit barcode serial batch inventory продукт баркод склад',
        label: t('search.productCatalog'),
        module: 'erp.warehouse',
        path: '/catalog',
      },
      {
        description: t('search.categoryDescription'),
        group: `${t('navigation.erp')} · ${t('navigation.warehouse')}`,
        icon: 'warehouse',
        keywords: 'category hierarchy serial batch expiry категория партида срок',
        label: t('search.productCategories'),
        module: 'erp.warehouse',
        path: '/catalog/categories',
      },
    ];
    const permitted = [...utilityDestinations, ...directDestinations, ...moduleDestinations]
      .filter(
        (item) =>
          !item.module ||
          (hasPermission(item.module) &&
            (!item.permission || hasPermission(item.module, item.permission))),
      )
      .concat(workflowDestinations);
    return [...new Map(permitted.map((item) => [item.path, item])).values()];
  }, [hasPermission, locale, t]);

  const results = useMemo(
    () => rankDestinations(destinations, query).slice(0, 8),
    [destinations, query],
  );

  useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [location.pathname]);

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (event.key !== '/' || isTyping || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function choose(destination: SearchDestination) {
    navigate(destination.path);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      event.currentTarget.blur();
      return;
    }
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((value) => (value + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((value) => (value - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      choose(results[Math.min(activeIndex, results.length - 1)]!);
    }
  }

  return (
    <div className="global-navigation-search" ref={rootRef} role="search">
      <div className="global-search-field">
        <Icon name="search" size={18} />
        <input
          aria-activedescendant={
            open && results[activeIndex] ? `workspace-search-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-controls="workspace-search-results"
          aria-expanded={open}
          aria-label={t('search.label')}
          autoComplete="off"
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={keyboard}
          placeholder={t('search.label')}
          ref={inputRef}
          role="combobox"
          type="search"
          value={query}
        />
        <kbd aria-hidden="true">/</kbd>
      </div>

      {open ? (
        <div className="global-search-panel">
          <header>
            <span>{query.trim() ? t('search.results') : t('search.quick')}</span>
            <small>
              {results.length
                ? t('search.shown', { count: results.length })
                : t('search.noMatches')}
            </small>
          </header>
          <div aria-label={t('search.destinations')} id="workspace-search-results" role="listbox">
            {results.length ? (
              results.map((destination, index) => (
                <button
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? 'is-active' : undefined}
                  id={`workspace-search-${index}`}
                  key={destination.path}
                  onClick={() => choose(destination)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <span className="global-search-result-icon">
                    <Icon name={destination.icon} size={18} />
                  </span>
                  <span className="global-search-result-copy">
                    <strong>{destination.label}</strong>
                    <small>{destination.description}</small>
                  </span>
                  <span className="global-search-result-group">{destination.group}</span>
                  <Icon name="arrow" size={16} />
                </button>
              ))
            ) : (
              <div className="global-search-empty">
                <Icon name="search" size={20} />
                <strong>{t('search.emptyTitle')}</strong>
                <p>{t('search.emptyHint')}</p>
              </div>
            )}
          </div>
          <footer>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> {t('search.move')}
            </span>
            <span>
              <kbd>Enter</kbd> {t('search.open')}
            </span>
            <span>
              <kbd>Esc</kbd> {t('search.close')}
            </span>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

function rankDestinations(destinations: SearchDestination[], query: string): SearchDestination[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return destinations.slice(0, 8);
  const terms = normalizedQuery.split(' ').filter(Boolean);
  return destinations
    .map((destination) => {
      const label = normalize(destination.label);
      const haystack = normalize(
        `${destination.label} ${destination.description} ${destination.group} ${destination.keywords ?? ''}`,
      );
      if (!terms.every((term) => haystack.includes(term))) return null;
      const score =
        label === normalizedQuery
          ? 0
          : label.startsWith(normalizedQuery)
            ? 1
            : label.includes(normalizedQuery)
              ? 2
              : haystack.includes(normalizedQuery)
                ? 3
                : 4;
      return { destination, score };
    })
    .filter((item): item is { destination: SearchDestination; score: number } => item !== null)
    .sort(
      (left, right) =>
        left.score - right.score || left.destination.label.localeCompare(right.destination.label),
    )
    .map((item) => item.destination);
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function moduleGroup(module: string, t: ReturnType<typeof useLocalization>['t']): string {
  if (module === 'crm') return 'CRM';
  if (module === 'reports') return t('navigation.reports');
  if (module.startsWith('erp.')) {
    return `${t('navigation.erp')} · ${moduleLabel(module, t)}`;
  }
  return t('navigation.administration');
}
