import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { WorkAreaCards, type WorkAreaItem } from '../components/WorkAreaCards';
import { allModuleItems, type ModuleKey } from '../navigation';
import { messages, moduleMessages } from '../messages';
import { Navigate } from '../routing/Router';
import { pagesForModule, workflowPath } from './workflow-pages';
import { workAreaMessages } from './work-area.messages';

export function ModulePage({ moduleKey }: { moduleKey: string }) {
  const { hasPermission } = useAuth();
  const module = moduleMessages[moduleKey as ModuleKey];
  const navigation = allModuleItems.find((item) => item.key === moduleKey);
  if (!module || !navigation || !hasPermission(navigation.key)) {
    return <Navigate replace to="/not-found" />;
  }
  const pages = pagesForModule(moduleKey).filter(
    (page) =>
      moduleKey !== 'erp.service' ||
      page.slug !== 'reports' ||
      hasPermission('erp.service', 'approve'),
  );
  const items: WorkAreaItem[] = [
    ...(moduleKey === 'crm' ? [workAreaMessages.partners] : []),
    ...(moduleKey === 'erp.warehouse'
      ? [workAreaMessages.catalog, workAreaMessages.categories]
      : []),
    ...pages.map((page) => ({
      path: workflowPath(page),
      label: page.title,
      description: page.description,
      icon: page.icon,
    })),
  ];
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
      <section className="content-panel work-area-panel">
        <div className="panel-heading">
          <h2>{workAreaMessages.title}</h2>
        </div>
        {items.length > 0 ? (
          <WorkAreaCards items={items} title={workAreaMessages.title} />
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
