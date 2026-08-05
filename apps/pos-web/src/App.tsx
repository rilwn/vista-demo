import { AppShell, StatusCard } from '@vista/ui';

import { messages } from './messages';

export function App() {
  return (
    <AppShell
      eyebrow="Vista Service · POS"
      status={<span className="vista-badge">{messages.status}</span>}
      subtitle={messages.subtitle}
      title={messages.title}
    >
      <div className="vista-grid">
        <StatusCard
          description={messages.catalogDescription}
          label={messages.catalogLabel}
          value={messages.catalogValue}
        />
        <StatusCard
          description={messages.fiscalDescription}
          label={messages.fiscalLabel}
          tone="warning"
          value={messages.fiscalValue}
        />
        <StatusCard
          description={messages.offlineDescription}
          label={messages.offlineLabel}
          tone="warning"
          value={messages.offlineValue}
        />
      </div>
    </AppShell>
  );
}
