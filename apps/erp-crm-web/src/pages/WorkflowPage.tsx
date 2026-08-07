import { Button, InlineAlert } from '@vista/ui';
import { useState } from 'react';

import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';
import { type WorkflowPageDefinition, pagesForModule, workflowPath } from './workflow-pages';

export function WorkflowPage({ page }: { page: WorkflowPageDefinition }) {
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  const relatedPages = pagesForModule(page.module);

  return (
    <div className="page-stack workflow-page">
      <header className="page-header workflow-header">
        <div>
          <p className="page-eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p>{page.description}</p>
        </div>
        <div className="workflow-header-actions">
          <span className="prototype-badge">Interface ready · data connection pending</span>
          <Button
            onClick={() =>
              setPreviewNotice(`${page.action} will open when this workflow API is connected.`)
            }
          >
            {page.action}
          </Button>
        </div>
      </header>

      {previewNotice ? <InlineAlert tone="info">{previewNotice}</InlineAlert> : null}

      <nav aria-label={`${page.title} workflow pages`} className="workflow-tabs">
        {relatedPages.map((item) => (
          <Link
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
            placeholder={`Search ${page.title.toLowerCase()}`}
          />
        </label>
        <div>
          <button type="button">All statuses</button>
          <button type="button">Current period</button>
          <button type="button">Filter</button>
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
                <strong>No live records yet</strong>
                <p>
                  This screen is ready for its API and database slice. No representative business
                  records are fabricated.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="workflow-sections" aria-label={`${page.title} capabilities`}>
        {page.sections.map((section) => (
          <article className="workflow-section-card" key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}
