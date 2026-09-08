import { InlineAlert } from '@vista/ui';
import { OperationsOverview } from './OperationsOverview';

import { useAuth } from '../auth/AuthProvider';
import { WorkAreaCards } from '../components/WorkAreaCards';
import { allModuleItems } from '../navigation';
import { messages } from '../messages';

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

      <section className="content-panel work-area-panel">
        <div className="panel-heading">
          <div>
            <h2>{messages.home.areasTitle}</h2>
          </div>
        </div>
        {modules.length > 0 ? (
          <WorkAreaCards items={modules} title={messages.home.areasTitle} />
        ) : (
          <InlineAlert title="Access not assigned" tone="warning">
            {messages.home.noModules}
          </InlineAlert>
        )}
      </section>
    </div>
  );
}
