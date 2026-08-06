import { InlineAlert } from '@vista/ui';

import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { allModuleItems } from '../navigation';
import { messages } from '../messages';
import { Link } from '../routing/Router';

export function HomePage() {
  const { hasPermission, session } = useAuth();
  if (!session) return null;

  const modules = allModuleItems.filter((module) => hasPermission(module.key));
  const permissions = session.context.permissions;
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

      <section className="summary-grid" aria-label="Account overview">
        <SummaryCard detail={messages.home.moduleCard} icon="home" value={String(modules.length)} />
        <SummaryCard
          detail={messages.home.accessCard}
          icon="key"
          value={String(permissions.length)}
        />
        <SummaryCard
          detail={messages.home.protectionCard}
          icon="shield"
          value={
            session.context.twoFactorVerified ? messages.home.twoFactor : messages.home.passwordOnly
          }
          wideValue
        />
      </section>

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
              <Link className="module-card" key={module.key} to={module.path}>
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

function SummaryCard({
  detail,
  icon,
  value,
  wideValue = false,
}: {
  detail: string;
  icon: Parameters<typeof Icon>[0]['name'];
  value: string;
  wideValue?: boolean;
}) {
  return (
    <article className="summary-card">
      <span className="summary-card-icon">
        <Icon name={icon} />
      </span>
      <div>
        <strong className={wideValue ? 'is-text' : undefined}>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}
