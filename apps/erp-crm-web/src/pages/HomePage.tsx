import { InlineAlert } from '@vista/ui';
import { OperationsOverview } from './OperationsOverview';

import { useAuth } from '../auth/AuthProvider';
import { WorkAreaCards } from '../components/WorkAreaCards';
import { useLocalization } from '../i18n/LocalizationProvider';
import { localizeModule } from '../i18n/navigation';
import { allModuleItems } from '../navigation';

export function HomePage() {
  const { hasPermission, session } = useAuth();
  const { t } = useLocalization();
  if (!session) return null;

  const modules = allModuleItems
    .filter((module) => hasPermission(module.key))
    .map((module) => localizeModule(module, t));
  const firstName = session.context.displayName.trim().split(/\s+/u)[0] ?? '';

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{t('home.eyebrow')}</p>
          <h1>{t('home.welcome', { name: firstName })}</h1>
          <p>{t('home.subtitle')}</p>
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
            <h2>{t('home.areas')}</h2>
          </div>
        </div>
        {modules.length > 0 ? (
          <WorkAreaCards items={modules} title={t('home.areas')} />
        ) : (
          <InlineAlert title={t('home.noAccessTitle')} tone="warning">
            {t('home.noAccess')}
          </InlineAlert>
        )}
      </section>
    </div>
  );
}
