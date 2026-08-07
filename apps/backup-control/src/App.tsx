import { useState } from 'react';

import { messages } from './messages';

type BackupScreen =
  'approvals' | 'audit' | 'dr-tests' | 'jobs' | 'overview' | 'policies' | 'sources';

const screens: Record<
  BackupScreen,
  { action: string; description: string; label: string; requirements: string[]; title: string }
> = {
  approvals: {
    title: 'Restore requests & approvals',
    label: 'Restores & approvals',
    action: 'Request restore',
    description:
      'Use a controlled request path for granular, database, server, and destructive restore operations.',
    requirements: [
      'Requester, approver, and executor separation',
      'Four-eyes approval for critical restore actions',
      'Granular and bare-metal restore scope',
    ],
  },
  audit: {
    title: 'Alerts & audit',
    label: 'Alerts & audit',
    action: 'Configure notification',
    description:
      'Review backup/restore events, failures, missed backups, and security notifications without making audit history deletable.',
    requirements: [
      'Email and SMS notification channels',
      'Success, failure, and missed-backup alerts',
      'Append-only backup and restore audit evidence',
    ],
  },
  'dr-tests': {
    title: 'Disaster recovery tests',
    label: 'DR tests',
    action: 'Plan DR test',
    description:
      'Plan and document test restores against RPO/RTO targets, corrective actions, and signed evidence.',
    requirements: [
      'File, database, server, and infrastructure scenarios',
      'RTO and RPO evidence',
      'Annual test reminder and signed protocol',
    ],
  },
  jobs: {
    title: 'Jobs & restore points',
    label: 'Jobs & restore points',
    action: 'Run verification',
    description:
      'Monitor scheduled backup execution, snapshots, copies, retention, verification, and errors.',
    requirements: [
      'Start/end time, source, state, and error detail',
      'Restore points and verification state',
      'Retention and copy visibility',
    ],
  },
  overview: {
    title: 'Backup operations',
    label: 'Overview',
    action: 'Review readiness',
    description:
      'A single operational view of protected sources, schedule health, restore readiness, and open risk—not a marketing dashboard.',
    requirements: [
      'Protected-source coverage',
      'Last execution and next expected run',
      'RPO/RTO risk and restore-readiness view',
    ],
  },
  policies: {
    title: 'Policies & schedules',
    label: 'Policies & schedules',
    action: 'Create policy',
    description:
      'Define approved full, incremental, differential, snapshot, image, retention, encryption, and storage policies.',
    requirements: [
      'Critical, important, and standard classifications',
      'Full/incremental/differential strategy',
      'Retention reduction requires critical approval',
    ],
  },
  sources: {
    title: 'Sources & data inventory',
    label: 'Sources & inventory',
    action: 'Add source',
    description:
      'Inventory approved servers, workstations, devices, databases, files, email, cloud services, and their data classification.',
    requirements: [
      'Physical and virtual servers',
      'Workstations, laptops, tablets, and phones',
      'Databases, file shares, email, and cloud services',
    ],
  },
};

export function App() {
  const [screen, setScreen] = useState<BackupScreen>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const active = screens[screen];

  return (
    <div className="backup-console">
      <aside className="backup-sidebar">
        <div className="backup-brand">
          <span>VS</span>
          <div>
            <strong>Vista Recovery</strong>
            <small>Backup & DR control</small>
          </div>
        </div>
        <div className="backup-posture">
          <span className="backup-risk-dot" />
          <div>
            <small>Operational posture</small>
            <strong>{messages.status}</strong>
          </div>
        </div>
        <nav aria-label="Backup control navigation">
          {(Object.keys(screens) as BackupScreen[]).map((item) => (
            <button
              className={screen === item ? 'is-active' : undefined}
              key={item}
              onClick={() => {
                setScreen(item);
                setNotice(null);
              }}
              type="button"
            >
              <i aria-hidden="true" />
              {screens[item].label}
            </button>
          ))}
        </nav>
        <p className="backup-sidebar-note">
          Critical actions require separated roles and recorded approval. No backup policy, restore
          point, or audit evidence is removed from this interface.
        </p>
      </aside>
      <main className="backup-main">
        <header className="backup-topbar">
          <div className="backup-topbar-context">
            <span>Vista Service · Vratsa</span>
            <strong>Recovery control room</strong>
          </div>
          <div className="backup-topbar-actions">
            <span className="backup-environment">Local workspace</span>
            <span>
              <i className="backup-risk-dot" /> Plan and hardware decisions pending
            </span>
          </div>
        </header>
        {notice ? (
          <div className="backup-notice" role="status">
            <span />
            {notice}
            <button aria-label="Dismiss notice" onClick={() => setNotice(null)} type="button">
              ×
            </button>
          </div>
        ) : null}
        <section className="backup-page-heading">
          <div>
            <p>{active.label}</p>
            <h1>{active.title}</h1>
            <span>{active.description}</span>
          </div>
          <button
            onClick={() =>
              setNotice(
                `${active.action} is ready as a UI workflow and will become available after the approved backup plan, source inventory, role assignments, and APIs are connected.`,
              )
            }
            type="button"
          >
            {active.action}
          </button>
        </section>
        <section className="backup-readiness-strip" aria-label="Readiness state">
          <article>
            <span>Source inventory</span>
            <strong>Not approved</strong>
            <small>Infrastructure scope is pending</small>
          </article>
          <article>
            <span>Backup policy</span>
            <strong>Not approved</strong>
            <small>RPO/RTO and retention are pending</small>
          </article>
          <article>
            <span>Restore evidence</span>
            <strong>Not recorded</strong>
            <small>DR test has not been accepted</small>
          </article>
        </section>
        <section className="backup-list-shell">
          <div className="backup-list-controls">
            <label>
              <span>Search</span>
              <input placeholder={`Search ${active.title.toLowerCase()}`} />
            </label>
            <button type="button">All states</button>
            <button type="button">Review period</button>
          </div>
          <div className="backup-table-head">
            <span>Reference</span>
            <span>Protected source / scope</span>
            <span>Status</span>
            <span>Owner</span>
            <span>Updated</span>
          </div>
          <div className="backup-empty">
            <div>
              <b>—</b>
              <h2>No approved records</h2>
              <p>
                This screen is ready for controlled data. It does not invent sources, restore
                points, policies, jobs, hardware, or compliance evidence.
              </p>
            </div>
          </div>
        </section>
        <section className="backup-requirements">
          {active.requirements.map((requirement) => (
            <article key={requirement}>
              <span>Designed requirement</span>
              <strong>{requirement}</strong>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
