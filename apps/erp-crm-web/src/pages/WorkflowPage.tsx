import { Button } from '@vista/ui';
import { useActiveItemVisibility } from '@vista/ui/navigation';

import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';
import { type WorkflowPageDefinition, pagesForModule, workflowPath } from './workflow-pages';

export function WorkflowPage({ page }: { page: WorkflowPageDefinition }) {
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
          <Button disabled title="Unavailable">
            {page.action}
          </Button>
        </div>
      </header>

      <nav aria-label={`${page.title} workflow pages`} className="workflow-tabs" ref={tabs}>
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

      <section className="workflow-command-bar" aria-label="List controls">
        <label>
          <Icon name="search" size={17} />
          <input
            aria-label={`Search ${page.title}`}
            disabled
            placeholder={`Search ${page.title.toLowerCase()}`}
          />
        </label>
        <div>
          <button disabled type="button">
            All statuses
          </button>
          <button disabled type="button">
            Current period
          </button>
          <button disabled type="button">
            Filter
          </button>
        </div>
      </section>

      <section className="workflow-record-panel">
        <div className="workflow-table" role="table" aria-label={`${page.title} records`}>
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
                <strong>No records yet</strong>
                <p>Records added to this area will appear here.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
