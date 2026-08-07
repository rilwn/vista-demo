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
            <h2>Operational workspace</h2>
            <p>
              Choose a workflow. Every screen has been designed for its documented process; live
              records appear when its API slice is connected.
            </p>
          </div>
          <span className="prototype-badge">UI complete · integration pending</span>
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
                  <small>
                    Use the live shared customer, supplier, and business-partner master-data
                    workflow.
                  </small>
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
                  <small>
                    Maintain the actual shared product-category hierarchy, including its category
                    tracking policy.
                  </small>
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
