import { InlineAlert } from '@vista/ui';
import { OperationsOverview } from './OperationsOverview';

import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { allModuleItems } from '../navigation';
import { messages } from '../messages';
import { Link } from '../routing/Router';

export function HomePage() {
  const { hasPermission, session } = useAuth();
  if (!session) return null;

  const modules = allModuleItems.filter((module) => hasPermission(module.key));
  const firstName = session.context.displayName.trim().split(/\s+/u)[0] ?? '';

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{messages.home.eyebrow}</p>
          <h1>
            {messages.home.title}, {firstName}.
          </h1>
          <p>{messages.home.subtitle}</p>
        </div>
      </header>

      {hasPermission('erp.finance') ||
      hasPermission('crm') ||
      hasPermission('erp.service', 'approve') ? (
        <OperationsOverview
          token={session.sessionToken}
          warrantyPath={
            hasPermission('crm') ? '/modules/crm/customer-care' : '/modules/erp.service/care'
          }
        />
      ) : null}

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <h2>{messages.home.areasTitle}</h2>
            <p>{messages.home.areasSubtitle}</p>
          </div>
        </div>
        {modules.length > 0 ? (
          <div className="module-card-grid">
            {modules.map((module) => (
              <Link className="module-card" key={module.path} to={module.path}>
                <span className="module-card-icon">
                  <Icon name={module.icon} />
                </span>
                <span className="module-card-copy">
                  <strong>{module.label}</strong>
                  <small>{module.description}</small>
                </span>
                <Icon name="arrow" />
              </Link>
            ))}
          </div>
        ) : (
          <InlineAlert title="Access not assigned" tone="warning">
            {messages.home.noModules}
          </InlineAlert>
        )}
      </section>
    </div>
  );
}
