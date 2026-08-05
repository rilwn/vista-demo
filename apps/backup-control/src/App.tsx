import { AppShell, StatusCard } from '@vista/ui';

import { messages } from './messages';

export function App() {
  return (
    <AppShell
      eyebrow="Vista Service · Backup & DR"
      status={<span className="vista-badge">{messages.status}</span>}
      subtitle={messages.subtitle}
      title={messages.title}
    >
      <div className="vista-grid">
        <StatusCard
          description={messages.inventoryDescription}
          label={messages.inventoryLabel}
          tone="warning"
          value={messages.inventoryValue}
        />
        <StatusCard
          description={messages.hardwareDescription}
          label={messages.hardwareLabel}
          tone="warning"
          value={messages.hardwareValue}
        />
        <StatusCard
          description={messages.restoreDescription}
          label={messages.restoreLabel}
          value={messages.restoreValue}
        />
      </div>
    </AppShell>
  );
}
