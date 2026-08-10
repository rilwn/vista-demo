import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { allModuleItems, type ModuleKey } from '../navigation';
import { messages, moduleMessages } from '../messages';
import { Link, Navigate } from '../routing/Router';
import { pagesForModule, workflowPath } from './workflow-pages';

export function ModulePage({ moduleKey }: { moduleKey: string }) {
  const { hasPermission } = useAuth();
  const module = moduleMessages[moduleKey as ModuleKey];
  const navigation = allModuleItems.find((item) => item.key === moduleKey);

  if (!module || !navigation || !hasPermission(navigation.key)) {
    return <Navigate replace to="/not-found" />;
  }

  const pages = pagesForModule(moduleKey);

  return (
    <div className="page-stack">
      <header className="page-header module-page-header">
        <span className="page-module-icon">
          <Icon name={navigation.icon} size={22} />
        </span>
        <div>
          <p className="page-eyebrow">{messages.module.eyebrow}</p>
          <h1>{module.label}</h1>
          <p>{module.description}</p>
        </div>
      </header>
      <section className="content-panel workflow-hub">
        <div className="panel-heading">
          <div>
            <h2>Choose an area</h2>
            <p>Open a section to view its records and actions.</p>
          </div>
        </div>
        {pages.length > 0 ? (
          <div className="workflow-hub-grid">
            {moduleKey === 'crm' ? (
              <Link className="workflow-hub-card" to="/partners">
                <span className="module-card-icon">
                  <Icon name="customers" />
                </span>
                <span>
                  <strong>Partner registry</strong>
                  <small>Manage customers, suppliers, contacts, locations, and equipment.</small>
                </span>
                <Icon name="arrow" />
              </Link>
            ) : null}
            {moduleKey === 'erp.warehouse' ? (
              <Link className="workflow-hub-card" to="/catalog">
                <span className="module-card-icon">
                  <Icon name="warehouse" />
                </span>
                <span>
                  <strong>Product catalog</strong>
                  <small>Manage products, units, barcodes, and tracking rules.</small>
                </span>
                <Icon name="arrow" />
              </Link>
            ) : null}
            {moduleKey === 'erp.warehouse' ? (
              <Link className="workflow-hub-card" to="/catalog/categories">
                <span className="module-card-icon">
                  <Icon name="warehouse" />
                </span>
                <span>
                  <strong>Product categories</strong>
                  <small>Organise products and set serial, batch, or expiry tracking.</small>
                </span>
                <Icon name="arrow" />
              </Link>
            ) : null}
            {pages.map((page) => (
              <Link className="workflow-hub-card" key={page.slug} to={workflowPath(page)}>
                <span className="module-card-icon">
                  <Icon name={page.icon} />
                </span>
                <span>
                  <strong>{page.title}</strong>
                  <small>{page.description}</small>
                </span>
                <Icon name="arrow" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="module-empty-state">
            <span className="empty-state-rule" aria-hidden="true" />
            <h2>{messages.module.emptyTitle}</h2>
            <p>{messages.module.emptyDescription}</p>
          </div>
        )}
      </section>
    </div>
  );
}
