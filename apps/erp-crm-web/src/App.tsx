import { useAuth } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { WorkspaceLayout } from './layout/WorkspaceLayout';
import { messages } from './messages';
import { AccessPage } from './pages/AccessPage';
import { CatalogPage } from './pages/CatalogPage';
import { HomePage } from './pages/HomePage';
import { ModulePage } from './pages/ModulePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrganizationPage } from './pages/OrganizationPage';
import { PartnersPage } from './pages/PartnersPage';
import { ProductCategoriesPage } from './pages/ProductCategoriesPage';
import { type ProcurementView, ProcurementPage } from './pages/ProcurementPage';
import {
  type SupplierProcurementView,
  SupplierProcurementPage,
} from './pages/SupplierProcurementPage';
import { SecurityAdministrationPage } from './pages/SecurityAdministrationPage';
import { SalesWorkflowPage } from './pages/SalesWorkflowPage';
import { SalesPricingPage } from './pages/SalesPricingPage';
import { SalesSubscriptionsPage } from './pages/SalesSubscriptionsPage';
import { SystemActivityPage } from './pages/SystemActivityPage';
import { type WarehouseView, WarehouseOperationsPage } from './pages/WarehouseOperationsPage';
import { WorkflowPage } from './pages/WorkflowPage';
import { findWorkflowPage } from './pages/workflow-pages';
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
  const warehousePath =
    /^\/modules\/erp\.warehouse\/(warehouses|stock|movements|stocktakes|reservations)$/u.exec(
      pathname,
    );
  if (warehousePath?.[1]) {
    return hasPermission('erp.warehouse') ? (
      <WarehouseOperationsPage view={warehousePath[1] as WarehouseView} />
    ) : (
      <NotFoundPage />
    );
  }
  const procurementPath = /^\/modules\/erp\.procurement\/(purchase-orders|goods-receipts)$/u.exec(
    pathname,
  );
  if (procurementPath?.[1]) {
    return hasPermission('erp.procurement') ? (
      <ProcurementPage view={procurementPath[1] as ProcurementView} />
    ) : (
      <NotFoundPage />
    );
  }
  const supplierProcurementPath =
    /^\/modules\/erp\.procurement\/(suppliers|supplier-invoices|supplier-claims)$/u.exec(pathname);
  if (supplierProcurementPath?.[1]) {
    return hasPermission('erp.procurement') ? (
      <SupplierProcurementPage view={supplierProcurementPath[1] as SupplierProcurementView} />
    ) : (
      <NotFoundPage />
    );
  }
  if (pathname === '/modules/erp.sales/price-lists') {
    return hasPermission('erp.sales') ? <SalesPricingPage /> : <NotFoundPage />;
  }
  if (pathname === '/modules/erp.sales/subscriptions') {
    return hasPermission('erp.sales') ? <SalesSubscriptionsPage /> : <NotFoundPage />;
  }
  if (/^\/modules\/erp\.sales\/(quotations|orders|shipments)$/u.test(pathname)) {
    return hasPermission('erp.sales') ? <SalesWorkflowPage /> : <NotFoundPage />;
  }
  const workflow = findWorkflowPage(pathname);
  if (workflow) {
    return hasPermission(workflow.module) ? <WorkflowPage page={workflow} /> : <NotFoundPage />;
  }
  if (pathname === '/') return <HomePage />;
  if (pathname === '/access') return <AccessPage />;
  if (pathname === '/organization') {
    return hasPermission('platform.organization') ? <OrganizationPage /> : <NotFoundPage />;
  }
  if (pathname === '/security') {
    return hasPermission('platform') ? <SecurityAdministrationPage /> : <NotFoundPage />;
  }
  if (pathname === '/operations') {
    return hasPermission('platform') ? <SystemActivityPage /> : <NotFoundPage />;
  }
  if (pathname === '/partners') {
    return hasPermission('crm') ? <PartnersPage /> : <NotFoundPage />;
  }
  if (pathname === '/catalog') {
    return hasPermission('erp.warehouse') ? <CatalogPage /> : <NotFoundPage />;
  }
  if (pathname === '/catalog/categories') {
    return hasPermission('erp.warehouse') ? <ProductCategoriesPage /> : <NotFoundPage />;
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
