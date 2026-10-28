import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AuthController } from '../auth/auth.controller.js';
import { CatalogController } from '../catalog/catalog.controller.js';
import { FilesController } from '../files/files.controller.js';
import { InventoryController } from '../inventory/inventory.controller.js';
import { IntegrationOperationsController } from '../integration/integration-operations.controller.js';
import { JobsController } from '../jobs/jobs.controller.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { OrganizationController } from '../organization/organization.controller.js';
import { CustomerAssetsController } from '../partners/customer-assets.controller.js';
import { PartnersController } from '../partners/partners.controller.js';
import { ProductCategoriesController } from '../product-categories/product-categories.controller.js';
import { ProcurementController } from '../procurement/procurement.controller.js';
import {
  CrmAfterSalesController,
  CrmPublicSurveyController,
} from '../crm/crm-after-sales.controller.js';
import { FinanceCustomerAccountsController } from '../finance/finance-customer-accounts.controller.js';
import { FinancialDocumentsController } from '../finance/financial-documents.controller.js';
import { RecurringInvoicesController } from '../finance/recurring-invoices.controller.js';
import { FinancialBrandingController } from '../finance/financial-branding.controller.js';
import { RootController } from '../root.controller.js';
import { SalesController } from '../sales/sales.controller.js';
import { SecurityAdministrationController } from '../security-administration/security-administration.controller.js';
import { RATE_LIMIT_POLICY, type RateLimitPolicyName } from './rate-limit.decorator.js';

const controllers = [
  AuthController,
  CrmAfterSalesController,
  CrmPublicSurveyController,
  CatalogController,
  FilesController,
  FinanceCustomerAccountsController,
  FinancialDocumentsController,
  RecurringInvoicesController,
  FinancialBrandingController,
  InventoryController,
  IntegrationOperationsController,
  JobsController,
  NotificationsController,
  OrganizationController,
  CustomerAssetsController,
  PartnersController,
  ProductCategoriesController,
  ProcurementController,
  RootController,
  SalesController,
  SecurityAdministrationController,
] as const;

type ControllerType = abstract new (...arguments_: never[]) => object;
type RouteHandler = (...arguments_: never[]) => unknown;

describe('HTTP rate-limit coverage', () => {
  it('assigns every non-health endpoint an explicit risk policy', () => {
    const assignments = controllers.flatMap((controller) =>
      routeHandlers(controller).map(({ handler, method, name }) => ({
        controller: controller.name,
        method,
        name,
        policy: readPolicy(handler) ?? readPolicy(controller),
      })),
    );

    expect(assignments).toHaveLength(201);
    expect(assignments.filter(({ policy }) => policy === undefined)).toEqual([]);
    expect(assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          controller: 'CrmAfterSalesController',
          name: 'createWarrantyCoverageOffer',
          policy: 'write',
        }),
        expect.objectContaining({
          controller: 'CrmAfterSalesController',
          name: 'transitionWarrantyCoverageOffer',
          policy: 'write',
        }),
        expect.objectContaining({
          controller: 'CrmPublicSurveyController',
          name: 'getSurvey',
          policy: 'public',
        }),
        expect.objectContaining({
          controller: 'CrmPublicSurveyController',
          name: 'submitResponse',
          policy: 'public',
        }),
        expect.objectContaining({
          controller: 'FinancialDocumentsController',
          name: 'collection',
          policy: 'write',
        }),
        expect.objectContaining({
          controller: 'FinanceCustomerAccountsController',
          name: 'paymentStatus',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'FinanceCustomerAccountsController',
          name: 'refund',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'FinanceCustomerAccountsController',
          name: 'allocateAdvance',
          policy: 'write',
        }),
        expect.objectContaining({ controller: 'AuthController', name: 'login', policy: 'public' }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'directoryOptions',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'startDirectoryLogin',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'completeOidcLogin',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'completeSamlLogin',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'samlMetadata',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'exchangeDirectoryLogin',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'JobsController',
          name: 'prometheus',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'completeRecovery',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'logout',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'changePassword',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'AuthController',
          name: 'startTotpEnrollment',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'InventoryController',
          name: 'completeStocktake',
          policy: 'sensitive',
        }),
        expect.objectContaining({
          controller: 'InventoryController',
          name: 'listStockReservations',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'InventoryController',
          name: 'stockMovements',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'InventoryController',
          name: 'searchSerialTraceability',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'SalesController',
          name: 'updateQuotation',
          policy: 'write',
        }),
        expect.objectContaining({
          controller: 'SalesController',
          name: 'cancelQuotation',
          policy: 'write',
        }),
        expect.objectContaining({
          controller: 'SalesController',
          name: 'quotationPdf',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'SalesController',
          name: 'emailQuotation',
          policy: 'write',
        }),
        expect.objectContaining({
          controller: 'FinancialDocumentsController',
          name: 'pdf',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'FinancialDocumentsController',
          name: 'email',
          policy: 'write',
        }),
        expect.objectContaining({
          controller: 'PartnersController',
          name: 'customerOperationalOverview',
          policy: 'read',
        }),
        expect.objectContaining({
          controller: 'SecurityAdministrationController',
          name: 'updateRole',
          policy: 'sensitive',
        }),
      ]),
    );

    for (const assignment of assignments) {
      expect(assignment.policy).toBe(expectedPolicy(assignment));
    }
  });
});

function routeHandlers(controller: ControllerType): Array<{
  handler: RouteHandler;
  method: RequestMethod;
  name: string;
}> {
  return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
    if (name === 'constructor') return [];
    const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as unknown;
    if (typeof handler !== 'function') return [];
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as unknown;
    return typeof method !== 'number' ? [] : [{ handler: handler as RouteHandler, method, name }];
  });
}

function readPolicy(target: object): RateLimitPolicyName | undefined {
  const value = Reflect.getMetadata(RATE_LIMIT_POLICY, target) as unknown;
  return value === 'public' || value === 'read' || value === 'sensitive' || value === 'write'
    ? value
    : undefined;
}

function expectedPolicy(assignment: {
  controller: string;
  method: RequestMethod;
  name: string;
}): RateLimitPolicyName {
  if (assignment.controller === 'RootController') return 'public';
  if (assignment.controller === 'CrmPublicSurveyController') return 'public';
  if (assignment.controller === 'AuthController' && assignment.name === 'login') return 'public';
  if (
    assignment.controller === 'AuthController' &&
    [
      'startDirectoryLogin',
      'completeOidcLogin',
      'completeSamlLogin',
      'exchangeDirectoryLogin',
    ].includes(assignment.name)
  ) {
    return 'sensitive';
  }
  if (
    assignment.controller === 'AuthController' &&
    (assignment.name === 'logout' ||
      assignment.name === 'completeRecovery' ||
      assignment.name === 'startRecoveryTotpEnrollment' ||
      assignment.name === 'verifyRecoveryTotpEnrollment' ||
      assignment.name === 'changePassword' ||
      assignment.name === 'startTotpEnrollment' ||
      assignment.name === 'verifyTotpEnrollment' ||
      assignment.name === 'disableTotp')
  ) {
    return 'sensitive';
  }
  if (
    assignment.controller === 'IntegrationOperationsController' &&
    assignment.method !== RequestMethod.GET
  ) {
    return 'sensitive';
  }
  if (
    assignment.controller === 'SecurityAdministrationController' &&
    assignment.method !== RequestMethod.GET
  ) {
    return 'sensitive';
  }
  if (assignment.controller === 'InventoryController' && assignment.name === 'completeStocktake') {
    return 'sensitive';
  }
  if (
    assignment.controller === 'FinanceCustomerAccountsController' &&
    assignment.name === 'refund'
  ) {
    return 'sensitive';
  }
  return assignment.method === RequestMethod.GET ? 'read' : 'write';
}
