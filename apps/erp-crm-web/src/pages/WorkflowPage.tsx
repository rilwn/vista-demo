import { Button } from '@vista/ui';
import { useActiveItemVisibility } from '@vista/ui/navigation';

import { Icon } from '../components/Icon';
import { useLocalization } from '../i18n/LocalizationProvider';
import { Link } from '../routing/Router';
import { type WorkflowPageDefinition, pagesForModule, workflowPath } from './workflow-pages';

export function WorkflowPage({ page }: { page: WorkflowPageDefinition }) {
  const { t } = useLocalization();
  const relatedPages = pagesForModule(page.module);
  const tabs = useActiveItemVisibility<HTMLElement>(page.slug);

  return (
    <div className="page-stack workflow-page">
      <header className="page-header workflow-header">
        <div>
          <p className="page-eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p>{page.description}</p>
        </div>
        <div className="workflow-header-actions">
          <Button disabled title={t('workflow.unavailable')}>
            {page.action}
          </Button>
        </div>
      </header>

      <nav
        aria-label={t('workflow.pages', { title: page.title })}
        className="workflow-tabs"
        ref={tabs}
      >
        {relatedPages.map((item) => (
          <Link
            aria-current={item.slug === page.slug ? 'page' : undefined}
            className={({ isActive }) => (isActive ? 'is-active' : undefined)}
            key={item.slug}
            to={workflowPath(item)}
          >
            {item.title}
          </Link>
        ))}
      </nav>

      <section className="workflow-command-bar" aria-label={t('workflow.listControls')}>
        <label>
          <Icon name="search" size={17} />
          <input
            aria-label={t('workflow.search', { title: page.title })}
            disabled
            placeholder={t('workflow.searchPlaceholder', { title: page.title.toLocaleLowerCase() })}
          />
        </label>
        <div>
          <button disabled type="button">
            {t('workflow.allStatuses')}
          </button>
          <button disabled type="button">
            {t('workflow.currentPeriod')}
          </button>
          <button disabled type="button">
            {t('workflow.filter')}
          </button>
        </div>
      </section>

      <section className="workflow-record-panel">
        <div
          className="workflow-table"
          role="table"
          aria-label={t('workflow.records', { title: page.title })}
        >
          <div className="workflow-table-head" role="row">
            {page.columns.map((column) => (
              <span key={column} role="columnheader">
                {column}
              </span>
            ))}
          </div>
          <div className="workflow-empty" role="row">
            <div>
              <span className="workflow-empty-icon">
                <Icon name={page.icon} size={22} />
              </span>
              <div>
                <strong>{t('workflow.emptyTitle')}</strong>
                <p>{t('workflow.emptyHint')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
