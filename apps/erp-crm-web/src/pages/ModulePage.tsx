import { InlineAlert } from '@vista/ui';

import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { allModuleItems, type ModuleKey } from '../navigation';
import { messages, moduleMessages } from '../messages';
import { Navigate } from '../routing/Router';

export function ModulePage({ moduleKey }: { moduleKey: string }) {
  const { hasPermission } = useAuth();
  const module = moduleMessages[moduleKey as ModuleKey];
  const navigation = allModuleItems.find((item) => item.key === moduleKey);

  if (!module || !navigation || !hasPermission(navigation.key)) {
    return <Navigate replace to="/not-found" />;
  }

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
      <section className="content-panel module-empty-state">
        <span className="empty-state-rule" aria-hidden="true" />
        <h2>{messages.module.emptyTitle}</h2>
        <p>{messages.module.emptyDescription}</p>
        <InlineAlert tone="info">{messages.module.alert}</InlineAlert>
      </section>
    </div>
  );
}
