import { useAuth } from '../auth/AuthProvider';
import { messages, moduleMessages } from '../messages';

export function AccessPage() {
  const { session } = useAuth();
  if (!session) return null;
  const permissions = [...session.context.permissions].sort((left, right) =>
    `${left.module}:${left.action}`.localeCompare(`${right.module}:${right.action}`),
  );

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{messages.access.eyebrow}</p>
          <h1>{messages.access.title}</h1>
          <p>{messages.access.subtitle}</p>
        </div>
        <span className="security-pill">
          {session.context.twoFactorVerified ? messages.home.twoFactor : messages.home.passwordOnly}
        </span>
      </header>

      <section className="content-panel access-panel">
        <div className="account-detail-row">
          <div>
            <span>{messages.access.employee}</span>
            <strong>{session.context.displayName}</strong>
          </div>
          <div>
            <span>{messages.access.email}</span>
            <strong>{session.context.email}</strong>
          </div>
          <div>
            <span>{messages.access.accessLevel}</span>
            <strong>
              {session.context.isAdministrative
                ? messages.home.adminAccess
                : messages.home.standardAccess}
            </strong>
          </div>
        </div>
        {permissions.length > 0 ? (
          <div className="table-scroll">
            <table className="access-table">
              <thead>
                <tr>
                  <th>{messages.access.module}</th>
                  <th>{messages.access.action}</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={`${permission.module}:${permission.action}`}>
                    <td>{formatModule(permission.module)}</td>
                    <td>
                      <span className="permission-tag">{formatAction(permission.action)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-copy">{messages.access.empty}</p>
        )}
      </section>
    </div>
  );
}

function formatModule(module: string): string {
  if (module === '*') return messages.access.wildcard;
  return moduleMessages[module as keyof typeof moduleMessages]?.label ?? module;
}

function formatAction(action: string): string {
  if (action === '*') return messages.access.wildcard;
  return action.charAt(0).toUpperCase() + action.slice(1);
}
