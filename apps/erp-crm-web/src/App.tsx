import { AppShell, StatusCard } from '@vista/ui';

import { messages } from './messages';

export function App() {
  return (
    <AppShell
      eyebrow={messages.eyebrow}
      status={<span className="vista-badge">{messages.status}</span>}
      subtitle={messages.subtitle}
      title={messages.title}
    >
      <div className="vista-grid">
        <StatusCard
          description={messages.foundationDescription}
          label={messages.foundationLabel}
          tone="positive"
          value={messages.foundationValue}
        />
        <StatusCard
          description={messages.masterDataDescription}
          label={messages.masterDataLabel}
          value={messages.masterDataValue}
        />
        <StatusCard
          description={messages.securityDescription}
          label={messages.securityLabel}
          tone="warning"
          value={messages.securityValue}
        />
      </div>
    </AppShell>
  );
}
