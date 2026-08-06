import { useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { WorkspaceLayout } from './layout/WorkspaceLayout';
import { messages } from './messages';
import { AccessPage } from './pages/AccessPage';
import { HomePage } from './pages/HomePage';
import { ModulePage } from './pages/ModulePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PartnersPage } from './pages/PartnersPage';
import { Navigate, useRouter } from './routing/Router';

export function App() {
  const { hasPermission, status } = useAuth();
  const { location } = useRouter();

  if (location.pathname === '/login') return <LoginPage />;
  if (status === 'checking') return <FullPageLoader />;
  if (status === 'anonymous') {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }

  return <WorkspaceLayout>{pageForPath(location.pathname, hasPermission)}</WorkspaceLayout>;
}

function pageForPath(
  pathname: string,
  hasPermission: (module: string, action?: string) => boolean,
) {
  if (pathname === '/') return <HomePage />;
  if (pathname === '/access') return <AccessPage />;
  if (pathname === '/partners') {
    return hasPermission('crm') ? <PartnersPage /> : <NotFoundPage />;
  }
  if (pathname === '/not-found') return <NotFoundPage />;
  const moduleMatch = /^\/modules\/(.+)$/u.exec(pathname);
  if (moduleMatch?.[1]) return <ModulePage moduleKey={moduleMatch[1]} />;
  return <NotFoundPage />;
}

function FullPageLoader() {
  return (
    <main className="full-page-loader" aria-live="polite">
      <span className="loader-mark" aria-hidden="true">
        VS
      </span>
      <strong>{messages.states.loading}</strong>
      <p>{messages.states.loadingDetail}</p>
    </main>
  );
}
