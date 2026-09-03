import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreateCustomerPriceGroupRequest,
  CreatePriceListRequest,
  CreatePosCommercialRuleRequest,
  CreatePromotionalCampaignRequest,
  CustomerPriceGroup,
  PriceList,
  PriceListScope,
  PosCommercialRule,
  PosCommercialRuleType,
  PosDiscountType,
  PromotionalCampaign,
  SalesPricingReferenceData,
  SalesResolvedPrice,
  UpdateCustomerPriceGroupRequest,
  UpdatePriceListRequest,
  UpdatePosCommercialRuleRequest,
  UpdatePromotionalCampaignRequest,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';

type GroupRow = {
  active: boolean;
  code: string;
  created_at: string;
  customer_partner_ids: string[];
  id: string;
  name: string;
  updated_at: string;
  version: number;
};

type CampaignRow = {
  active: boolean;
  code: string;
  created_at: string;
  id: string;
  name: string;
  updated_at: string;
  valid_from: string;
  valid_to: string;
  version: number;
};

type PriceListRow = {
  active: boolean;
  campaign_id: string | null;
  campaign_name: string | null;
  code: string;
  created_at: string;
  currency_code: string;
  customer_group_id: string | null;
  customer_group_name: string | null;
  customer_name: string | null;
  customer_partner_id: string | null;
  id: string;
  name: string;
  priority: number;
  scope: PriceListScope;
  updated_at: string;
  valid_from: string;
  valid_to: string;
  version: number;
};

type PosCommercialRuleRow = {
  active: boolean;
  code: string;
  created_at: string;
  discount_type: PosDiscountType;
  discount_value: string;
  id: string;
  name: string;
  priority: number;
  rule_type: PosCommercialRuleType;
  updated_at: string;
  valid_from: string;
  valid_to: string;
  version: number;
};

@Injectable()
export class SalesPricingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async referenceData(): Promise<SalesPricingReferenceData> {
    const [customers, products, customerGroups, campaigns] = await Promise.all([
      this.database.getPool().query<{ id: string; name: string }>(
        `SELECT partner.id, partner.display_name AS name
         FROM master_data.partners partner
         JOIN master_data.partner_roles role ON role.partner_id = partner.id
         WHERE partner.active AND role.role = 'customer'
         ORDER BY partner.display_name, partner.id`,
      ),
      this.database.getPool().query<{ id: string; name: string; product_code: string }>(
        `SELECT product.id, product.name, product.product_code
         FROM master_data.products product
         JOIN master_data.product_categories category ON category.id = product.category_id
         WHERE product.active AND category.active
         ORDER BY product.name, product.id`,
      ),
      this.customerGroups(),
      this.campaigns(),
    ]);
    return {
      campaigns,
      customerGroups,
      customers: customers.rows,
      products: products.rows.map((row) => ({
        id: row.id,
        name: row.name,
        productCode: row.product_code,
      })),
    };
  }

  async customerGroups(): Promise<CustomerPriceGroup[]> {
    const result = await this.database.getPool().query<GroupRow>(groupQuery());
    return result.rows.map(mapGroup);
  }

  async createCustomerGroup(
    input: CreateCustomerPriceGroupRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerPriceGroup> {
    const normalized = normalizeGroup(input);
    return this.command(
      'sales.customer-price-group.create',
      key,
      normalized,
      HttpStatus.CREATED,
      async (client, idempotencyKey) => {
        await this.requireCustomers(client, normalized.customerPartnerIds);
        const id = randomUUID();
        await client.query(
          `INSERT INTO sales.customer_price_groups (
             id, code, name, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $4)`,
          [id, normalized.code, normalized.name, auth.accountId],
        );
        await this.replaceGroupMembers(client, id, normalized.customerPartnerIds, auth.accountId);
        const group = await this.group(client, id);
        await this.sideEffects(
          client,
          'customer_price_group',
          id,
          'sales.customer_price_group.created',
          group,
          auth,
          metadata,
          idempotencyKey,
        );
        return group;
      },
    );
  }

  async updateCustomerGroup(
    id: string,
    input: UpdateCustomerPriceGroupRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CustomerPriceGroup> {
    const normalized = normalizeGroupUpdate(input);
    return this.command(
      `sales.customer-price-group.update:${id}`,
      key,
      normalized,
      HttpStatus.OK,
      async (client, idempotencyKey) => {
        await this.requireCustomers(client, normalized.customerPartnerIds);
        const before = await this.group(client, id, true);
        if (before.version !== normalized.version) throw staleVersion('customer group');
        await client.query(
          `UPDATE sales.customer_price_groups
           SET name = $2, active = $3, version = version + 1,
               updated_by = $4, updated_at = now()
           WHERE id = $1`,
          [id, normalized.name, normalized.active, auth.accountId],
        );
        await this.replaceGroupMembers(client, id, normalized.customerPartnerIds, auth.accountId);
        const group = await this.group(client, id);
        await this.sideEffects(
          client,
          'customer_price_group',
          id,
          'sales.customer_price_group.updated',
          { after: group, before },
          auth,
          metadata,
          idempotencyKey,
        );
        return group;
      },
    );
  }

  async campaigns(): Promise<PromotionalCampaign[]> {
    const result = await this.database.getPool().query<CampaignRow>(
      `SELECT id, code, name, valid_from::text, valid_to::text, active, version,
              created_at, updated_at
       FROM sales.promotional_campaigns ORDER BY valid_from DESC, code, id`,
    );
    return result.rows.map(mapCampaign);
  }

  async createCampaign(
    input: CreatePromotionalCampaignRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PromotionalCampaign> {
    const normalized = normalizeCampaign(input);
    return this.command(
      'sales.promotional-campaign.create',
      key,
      normalized,
      HttpStatus.CREATED,
      async (client, idempotencyKey) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO sales.promotional_campaigns (
             id, code, name, valid_from, valid_to, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [
            id,
            normalized.code,
            normalized.name,
            normalized.validFrom,
            normalized.validTo,
            auth.accountId,
          ],
        );
        const campaign = await this.campaign(client, id);
        await this.sideEffects(
          client,
          'promotional_campaign',
          id,
          'sales.promotional_campaign.created',
          campaign,
          auth,
          metadata,
          idempotencyKey,
        );
        return campaign;
      },
    );
  }

  async updateCampaign(
    id: string,
    input: UpdatePromotionalCampaignRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PromotionalCampaign> {
    const normalized = normalizeCampaignUpdate(input);
    return this.command(
      `sales.promotional-campaign.update:${id}`,
      key,
      normalized,
      HttpStatus.OK,
      async (client, idempotencyKey) => {
        const before = await this.campaign(client, id, true);
        if (before.version !== normalized.version) throw staleVersion('campaign');
        await client.query(
          `UPDATE sales.promotional_campaigns
           SET name = $2, valid_from = $3, valid_to = $4, active = $5,
               version = version + 1, updated_by = $6, updated_at = now()
           WHERE id = $1`,
          [
            id,
            normalized.name,
            normalized.validFrom,
            normalized.validTo,
            normalized.active,
            auth.accountId,
          ],
        );
        const campaign = await this.campaign(client, id);
        await this.sideEffects(
          client,
          'promotional_campaign',
          id,
          'sales.promotional_campaign.updated',
          { after: campaign, before },
          auth,
          metadata,
          idempotencyKey,
        );
        return campaign;
      },
    );
  }

  async priceLists(): Promise<PriceList[]> {
    const result = await this.database
      .getPool()
      .query<{ id: string }>(
        'SELECT id FROM sales.price_lists ORDER BY active DESC, priority DESC, code, id',
      );
    return Promise.all(result.rows.map((row) => this.priceListFromPool(row.id)));
  }

  async posCommercialRules(): Promise<PosCommercialRule[]> {
    const result = await this.database.getPool().query<{ id: string }>(
      `SELECT id FROM sales.pos_commercial_rules
         ORDER BY active DESC, priority DESC, code, id`,
    );
    return Promise.all(result.rows.map((row) => this.posCommercialRuleFromPool(row.id)));
  }

  async createPosCommercialRule(
    input: CreatePosCommercialRuleRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosCommercialRule> {
    const normalized = normalizePosCommercialRule(input);
    return this.command(
      'sales.pos-commercial-rule.create',
      key,
      normalized,
      HttpStatus.CREATED,
      async (client, idempotencyKey) => {
        await this.requireProducts(
          client,
          normalized.items.map((item) => item.productId),
        );
        const id = randomUUID();
        await client.query(
          `INSERT INTO sales.pos_commercial_rules (
             id, code, name, rule_type, discount_type, discount_value,
             priority, valid_from, valid_to, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [
            id,
            normalized.code,
            normalized.name,
            normalized.ruleType,
            normalized.discountType,
            normalized.discountValue,
            normalized.priority,
            normalized.validFrom,
            normalized.validTo,
            auth.accountId,
          ],
        );
        await this.replacePosCommercialRuleItems(client, id, normalized.items);
        const rule = await this.posCommercialRule(client, id);
        await this.sideEffects(
          client,
          'pos_commercial_rule',
          id,
          'sales.pos_commercial_rule.created',
          rule,
          auth,
          metadata,
          idempotencyKey,
        );
        return rule;
      },
    );
  }

  async updatePosCommercialRule(
    id: string,
    input: UpdatePosCommercialRuleRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PosCommercialRule> {
    const normalized = normalizePosCommercialRuleUpdate(input);
    return this.command(
      `sales.pos-commercial-rule.update:${id}`,
      key,
      normalized,
      HttpStatus.OK,
      async (client, idempotencyKey) => {
        await this.requireProducts(
          client,
          normalized.items.map((item) => item.productId),
        );
        const before = await this.posCommercialRule(client, id, true);
        if (before.version !== normalized.version) throw staleVersion('POS offer');
        await client.query(
          `UPDATE sales.pos_commercial_rules SET name = $2, rule_type = $3,
             discount_type = $4, discount_value = $5, priority = $6,
             valid_from = $7, valid_to = $8, active = $9,
             version = version + 1, updated_by = $10, updated_at = now()
           WHERE id = $1`,
          [
            id,
            normalized.name,
            normalized.ruleType,
            normalized.discountType,
            normalized.discountValue,
            normalized.priority,
            normalized.validFrom,
            normalized.validTo,
            normalized.active,
            auth.accountId,
          ],
        );
        await this.replacePosCommercialRuleItems(client, id, normalized.items);
        const rule = await this.posCommercialRule(client, id);
        await this.sideEffects(
          client,
          'pos_commercial_rule',
          id,
          'sales.pos_commercial_rule.updated',
          { after: rule, before },
          auth,
          metadata,
          idempotencyKey,
        );
        return rule;
      },
    );
  }

  async createPriceList(
    input: CreatePriceListRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PriceList> {
    const normalized = normalizePriceList(input);
    return this.command(
      'sales.price-list.create',
      key,
      normalized,
      HttpStatus.CREATED,
      async (client, idempotencyKey) => {
        await this.requirePricingReferences(client, normalized);
        const id = randomUUID();
        await client.query(
          `INSERT INTO sales.price_lists (
             id, code, name, scope, customer_group_id, customer_partner_id,
             campaign_id, currency_code, valid_from, valid_to, priority,
             created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
          [
            id,
            normalized.code,
            normalized.name,
            normalized.scope,
            normalized.customerGroupId ?? null,
            normalized.customerPartnerId ?? null,
            normalized.campaignId ?? null,
            normalized.currencyCode,
            normalized.validFrom,
            normalized.validTo,
            normalized.priority,
            auth.accountId,
          ],
        );
        await this.replacePriceLines(client, id, normalized.lines);
        const priceList = await this.priceList(client, id);
        await this.sideEffects(
          client,
          'price_list',
          id,
          'sales.price_list.created',
          priceList,
          auth,
          metadata,
          idempotencyKey,
        );
        return priceList;
      },
    );
  }

  async updatePriceList(
    id: string,
    input: UpdatePriceListRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PriceList> {
    const normalized = normalizePriceListUpdate(input);
    return this.command(
      `sales.price-list.update:${id}`,
      key,
      normalized,
      HttpStatus.OK,
      async (client, idempotencyKey) => {
        await this.requirePricingReferences(client, normalized);
        const before = await this.priceList(client, id, true);
        if (before.version !== normalized.version) throw staleVersion('price list');
        await client.query(
          `UPDATE sales.price_lists
           SET code = $2, name = $3, scope = $4, customer_group_id = $5,
               customer_partner_id = $6, campaign_id = $7, currency_code = $8,
               valid_from = $9, valid_to = $10, priority = $11, active = $12,
               version = version + 1, updated_by = $13, updated_at = now()
           WHERE id = $1`,
          [
            id,
            normalized.code,
            normalized.name,
            normalized.scope,
            normalized.customerGroupId ?? null,
            normalized.customerPartnerId ?? null,
            normalized.campaignId ?? null,
            normalized.currencyCode,
            normalized.validFrom,
            normalized.validTo,
            normalized.priority,
            normalized.active,
            auth.accountId,
          ],
        );
        await this.replacePriceLines(client, id, normalized.lines);
        const priceList = await this.priceList(client, id);
        await this.sideEffects(
          client,
          'price_list',
          id,
          'sales.price_list.updated',
          { after: priceList, before },
          auth,
          metadata,
          idempotencyKey,
        );
        return priceList;
      },
    );
  }

  async resolvePrice(
    customerPartnerId: string,
    productId: string,
    asOf: string,
    currencyCode: string,
  ): Promise<SalesResolvedPrice> {
    const date = normalizeDate(asOf);
    const currency = normalizeCurrency(currencyCode);
    const client = await this.database.getPool().connect();
    try {
      await this.requireCustomers(client, [customerPartnerId]);
      await this.requireProducts(client, [productId]);
      const result = await client.query<{
        code: string;
        currency_code: string;
        id: string;
        name: string;
        priority: number;
        unit_price: string;
      }>(
        `SELECT list.id, list.code, list.name, list.currency_code,
                list.priority, line.unit_price::text
         FROM sales.price_list_lines line
         JOIN sales.price_lists list ON list.id = line.price_list_id
         LEFT JOIN sales.promotional_campaigns campaign ON campaign.id = list.campaign_id
         WHERE line.product_id = $1
           AND list.active
           AND list.currency_code = $4
           AND $2::date BETWEEN list.valid_from AND list.valid_to
           AND (
             campaign.id IS NULL OR (
               campaign.active AND $2::date BETWEEN campaign.valid_from AND campaign.valid_to
             )
           )
           AND (
             list.scope = 'all_customers'
             OR (list.scope = 'customer' AND list.customer_partner_id = $3)
             OR (
               list.scope = 'customer_group'
               AND EXISTS (
                 SELECT 1 FROM sales.customer_price_group_members member
                 JOIN sales.customer_price_groups customer_group
                   ON customer_group.id = member.customer_group_id
                 WHERE member.customer_group_id = list.customer_group_id
                   AND member.customer_partner_id = $3
                   AND customer_group.active
               )
             )
           )
         ORDER BY list.priority DESC,
           CASE list.scope WHEN 'customer' THEN 3 WHEN 'customer_group' THEN 2 ELSE 1 END DESC,
           list.code, list.id
         LIMIT 1`,
        [productId, date, customerPartnerId, currency],
      );
      const match = result.rows[0];
      if (!match) return { asOf: date, currencyCode: currency, matched: false, productId };
      return {
        asOf: date,
        currencyCode: match.currency_code,
        matched: true,
        priceListCode: match.code,
        priceListId: match.id,
        priceListName: match.name,
        priority: match.priority,
        productId,
        unitPrice: match.unit_price,
      };
    } finally {
      client.release();
    }
  }

  private async group(client: PoolClient, id: string, lock = false): Promise<CustomerPriceGroup> {
    if (lock) {
      const locked = await client.query(
        'SELECT id FROM sales.customer_price_groups WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!locked.rowCount) throw notFound('customer group');
    }
    const result = await client.query<GroupRow>(
      `SELECT * FROM (${groupQuery()}) customer_group_record WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('customer group');
    return mapGroup(row);
  }

  private async campaign(
    client: PoolClient,
    id: string,
    lock = false,
  ): Promise<PromotionalCampaign> {
    const result = await client.query<CampaignRow>(
      `SELECT id, code, name, valid_from::text, valid_to::text, active, version,
              created_at, updated_at
       FROM sales.promotional_campaigns WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('campaign');
    return mapCampaign(row);
  }

  private async priceListFromPool(id: string): Promise<PriceList> {
    const client = await this.database.getPool().connect();
    try {
      return await this.priceList(client, id);
    } finally {
      client.release();
    }
  }

  private async priceList(client: PoolClient, id: string, lock = false): Promise<PriceList> {
    if (lock) {
      const locked = await client.query(
        'SELECT id FROM sales.price_lists WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!locked.rowCount) throw notFound('price list');
    }
    const result = await client.query<PriceListRow>(
      `SELECT list.id, list.code, list.name, list.scope, list.customer_group_id,
              customer_group.name AS customer_group_name, list.customer_partner_id,
              customer.display_name AS customer_name, list.campaign_id,
              campaign.name AS campaign_name, list.currency_code, list.valid_from::text,
              list.valid_to::text, list.priority, list.active, list.version,
              list.created_at, list.updated_at
       FROM sales.price_lists list
       LEFT JOIN sales.customer_price_groups customer_group ON customer_group.id = list.customer_group_id
       LEFT JOIN master_data.partners customer ON customer.id = list.customer_partner_id
       LEFT JOIN sales.promotional_campaigns campaign ON campaign.id = list.campaign_id
       WHERE list.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('price list');
    const lines = await client.query<{
      id: string;
      product_code: string;
      product_id: string;
      product_name: string;
      unit_price: string;
    }>(
      `SELECT line.id, line.product_id, product.product_code,
              product.name AS product_name, line.unit_price::text
       FROM sales.price_list_lines line
       JOIN master_data.products product ON product.id = line.product_id
       WHERE line.price_list_id = $1 ORDER BY product.name, product.id`,
      [id],
    );
    return {
      active: row.active,
      ...(row.campaign_id && row.campaign_name
        ? { campaign: { id: row.campaign_id, name: row.campaign_name } }
        : {}),
      code: row.code,
      createdAt: asIso(row.created_at),
      currencyCode: row.currency_code,
      ...(row.customer_partner_id && row.customer_name
        ? { customer: { id: row.customer_partner_id, name: row.customer_name } }
        : {}),
      ...(row.customer_group_id && row.customer_group_name
        ? { customerGroup: { id: row.customer_group_id, name: row.customer_group_name } }
        : {}),
      id: row.id,
      lines: lines.rows.map((line) => ({
        id: line.id,
        productCode: line.product_code,
        productId: line.product_id,
        productName: line.product_name,
        unitPrice: line.unit_price,
      })),
      name: row.name,
      priority: row.priority,
      scope: row.scope,
      updatedAt: asIso(row.updated_at),
      validFrom: row.valid_from,
      validTo: row.valid_to,
      version: row.version,
    };
  }

  private async posCommercialRuleFromPool(id: string): Promise<PosCommercialRule> {
    const client = await this.database.getPool().connect();
    try {
      return await this.posCommercialRule(client, id);
    } finally {
      client.release();
    }
  }

  private async posCommercialRule(
    client: PoolClient,
    id: string,
    lock = false,
  ): Promise<PosCommercialRule> {
    if (lock) {
      const locked = await client.query(
        'SELECT id FROM sales.pos_commercial_rules WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!locked.rowCount) throw notFound('POS offer');
    }
    const result = await client.query<PosCommercialRuleRow>(
      `SELECT id, code, name, rule_type, discount_type, discount_value::text,
         priority, valid_from::text, valid_to::text, active, version,
         created_at, updated_at
       FROM sales.pos_commercial_rules WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('POS offer');
    const items = await client.query<{
      product_code: string;
      product_id: string;
      product_name: string;
      required_quantity: string;
    }>(
      `SELECT item.product_id, product.product_code, product.name AS product_name,
         item.required_quantity::text
       FROM sales.pos_commercial_rule_items item
       JOIN master_data.products product ON product.id = item.product_id
       WHERE item.rule_id = $1 ORDER BY product.name, product.id`,
      [id],
    );
    return {
      active: row.active,
      code: row.code,
      createdAt: asIso(row.created_at),
      discountType: row.discount_type,
      discountValue: row.discount_value,
      id: row.id,
      items: items.rows.map((item) => ({
        productCode: item.product_code,
        productId: item.product_id,
        productName: item.product_name,
        requiredQuantity: item.required_quantity,
      })),
      name: row.name,
      priority: row.priority,
      ruleType: row.rule_type,
      updatedAt: asIso(row.updated_at),
      validFrom: row.valid_from,
      validTo: row.valid_to,
      version: row.version,
    };
  }

  private async replacePosCommercialRuleItems(
    client: PoolClient,
    ruleId: string,
    items: Array<{ productId: string; requiredQuantity: string }>,
  ) {
    await client.query('DELETE FROM sales.pos_commercial_rule_items WHERE rule_id = $1', [ruleId]);
    for (const item of items)
      await client.query(
        `INSERT INTO sales.pos_commercial_rule_items (
           rule_id, product_id, required_quantity
         ) VALUES ($1,$2,$3)`,
        [ruleId, item.productId, item.requiredQuantity],
      );
  }

  private async requirePricingReferences(
    client: PoolClient,
    input: ReturnType<typeof normalizePriceList>,
  ) {
    await this.requireProducts(
      client,
      input.lines.map((line) => line.productId),
    );
    if (input.scope === 'customer')
      await this.requireCustomers(client, [
        required(input.customerPartnerId, 'Customer is required'),
      ]);
    if (input.scope === 'customer_group') {
      const group = await client.query(
        'SELECT id FROM sales.customer_price_groups WHERE id = $1 AND active FOR KEY SHARE',
        [required(input.customerGroupId, 'Customer group is required')],
      );
      if (!group.rowCount)
        throw new ApiErrorException(
          'SALES_CUSTOMER_GROUP_NOT_FOUND',
          'The selected customer group was not found or is inactive',
          HttpStatus.NOT_FOUND,
        );
    }
    if (input.campaignId) {
      const campaign = await client.query(
        'SELECT id FROM sales.promotional_campaigns WHERE id = $1 FOR KEY SHARE',
        [input.campaignId],
      );
      if (!campaign.rowCount) throw notFound('campaign');
    }
  }

  private async requireCustomers(client: PoolClient, ids: string[]) {
    if (!ids.length) return;
    const result = await client.query<{ id: string }>(
      `SELECT partner.id FROM master_data.partners partner
       JOIN master_data.partner_roles role ON role.partner_id = partner.id
       WHERE partner.id = ANY($1::uuid[]) AND partner.active AND role.role = 'customer'
       FOR KEY SHARE OF partner`,
      [ids],
    );
    if (result.rowCount !== ids.length)
      throw new ApiErrorException(
        'SALES_CUSTOMER_NOT_FOUND',
        'One or more selected customers were not found or are inactive',
        HttpStatus.NOT_FOUND,
      );
  }

  private async requireProducts(client: PoolClient, ids: string[]) {
    const result = await client.query<{ id: string }>(
      `SELECT product.id FROM master_data.products product
       JOIN master_data.product_categories category ON category.id = product.category_id
       WHERE product.id = ANY($1::uuid[]) AND product.active AND category.active
       FOR KEY SHARE OF product`,
      [ids],
    );
    if (result.rowCount !== ids.length)
      throw new ApiErrorException(
        'SALES_PRODUCT_NOT_FOUND',
        'One or more selected products were not found or are inactive',
        HttpStatus.NOT_FOUND,
      );
  }

  private async replaceGroupMembers(
    client: PoolClient,
    groupId: string,
    customerIds: string[],
    actorId: string,
  ) {
    await client.query(
      'DELETE FROM sales.customer_price_group_members WHERE customer_group_id = $1',
      [groupId],
    );
    for (const customerId of customerIds)
      await client.query(
        `INSERT INTO sales.customer_price_group_members (
           customer_group_id, customer_partner_id, assigned_by
         ) VALUES ($1, $2, $3)`,
        [groupId, customerId, actorId],
      );
  }

  private async replacePriceLines(
    client: PoolClient,
    priceListId: string,
    lines: Array<{ productId: string; unitPrice: string }>,
  ) {
    await client.query('DELETE FROM sales.price_list_lines WHERE price_list_id = $1', [
      priceListId,
    ]);
    for (const line of lines)
      await client.query(
        `INSERT INTO sales.price_list_lines (id, price_list_id, product_id, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), priceListId, line.productId, line.unitPrice],
      );
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    responseStatus: number,
    action: (client: PoolClient, idempotencyKey: string) => Promise<T>,
  ): Promise<T> {
    const idempotencyKey = validKey(key);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claim(client, scope, idempotencyKey, hash);
      if (replay) {
        await client.query('COMMIT');
        return replay as T;
      }
      const result = await action(client, idempotencyKey);
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = $3, response_body = $4
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, idempotencyKey, responseStatus, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error))
        throw new ApiErrorException(
          'SALES_PRICING_CONFLICT',
          'A pricing record with the same code or name already exists',
          HttpStatus.CONFLICT,
        );
      throw error;
    } finally {
      client.release();
    }
  }

  private async sideEffects(
    client: PoolClient,
    targetType: string,
    targetId: string,
    eventType: string,
    payload: object,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    idempotencyKey: string,
  ) {
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
      [
        randomUUID(),
        targetType,
        targetId,
        eventType,
        metadata.correlationId,
        `${eventType}:${idempotencyKey}`,
        payload,
      ],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: auth.accountId,
        after: payload as Record<string, unknown>,
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId,
        targetType,
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }
}

function groupQuery() {
  return `SELECT customer_group.id, customer_group.code, customer_group.name,
                 customer_group.active, customer_group.version,
                 customer_group.created_at, customer_group.updated_at,
                 coalesce(
                   array_agg(member.customer_partner_id ORDER BY member.customer_partner_id)
                     FILTER (WHERE member.customer_partner_id IS NOT NULL),
                   '{}'::uuid[]
                 ) AS customer_partner_ids
          FROM sales.customer_price_groups customer_group
          LEFT JOIN sales.customer_price_group_members member
            ON member.customer_group_id = customer_group.id
          GROUP BY customer_group.id`;
}

function mapGroup(row: GroupRow): CustomerPriceGroup {
  return {
    active: row.active,
    code: row.code,
    createdAt: asIso(row.created_at),
    customerPartnerIds: row.customer_partner_ids,
    id: row.id,
    name: row.name,
    updatedAt: asIso(row.updated_at),
    version: row.version,
  };
}

function mapCampaign(row: CampaignRow): PromotionalCampaign {
  return {
    active: row.active,
    code: row.code,
    createdAt: asIso(row.created_at),
    id: row.id,
    name: row.name,
    updatedAt: asIso(row.updated_at),
    validFrom: row.valid_from,
    validTo: row.valid_to,
    version: row.version,
  };
}

function normalizeGroup(input: CreateCustomerPriceGroupRequest) {
  return {
    code: normalizeCode(input.code),
    customerPartnerIds: uniqueIds(input.customerPartnerIds),
    name: normalizeName(input.name),
  };
}

function normalizeGroupUpdate(input: UpdateCustomerPriceGroupRequest) {
  return {
    active: input.active,
    customerPartnerIds: uniqueIds(input.customerPartnerIds),
    name: normalizeName(input.name),
    version: positiveVersion(input.version),
  };
}

function normalizeCampaign(input: CreatePromotionalCampaignRequest) {
  const dates = normalizePeriod(input.validFrom, input.validTo);
  return { code: normalizeCode(input.code), name: normalizeName(input.name), ...dates };
}

function normalizeCampaignUpdate(input: UpdatePromotionalCampaignRequest) {
  const dates = normalizePeriod(input.validFrom, input.validTo);
  return {
    active: input.active,
    name: normalizeName(input.name),
    version: positiveVersion(input.version),
    ...dates,
  };
}

function normalizePriceList(input: CreatePriceListRequest) {
  return normalizePriceListCore(input);
}

function normalizePriceListUpdate(input: UpdatePriceListRequest) {
  return {
    ...normalizePriceListCore(input),
    active: input.active,
    version: positiveVersion(input.version),
  };
}

function normalizePriceListCore(input: CreatePriceListRequest) {
  const dates = normalizePeriod(input.validFrom, input.validTo);
  const productIds = input.lines.map((line) => line.productId);
  if (!productIds.length)
    throw new ApiErrorException(
      'SALES_PRICE_LIST_LINES_REQUIRED',
      'Add at least one product price',
      HttpStatus.BAD_REQUEST,
    );
  if (new Set(productIds).size !== productIds.length)
    throw new ApiErrorException(
      'SALES_PRICE_LIST_PRODUCT_DUPLICATE',
      'Each product can appear only once in a price list',
      HttpStatus.BAD_REQUEST,
    );
  const targets = normalizeScope(input.scope, input.customerGroupId, input.customerPartnerId);
  if (!Number.isInteger(input.priority) || input.priority < -1000 || input.priority > 1000)
    throw new ApiErrorException(
      'SALES_PRICE_LIST_PRIORITY_INVALID',
      'Priority must be a whole number between -1000 and 1000',
      HttpStatus.BAD_REQUEST,
    );
  return {
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    code: normalizeCode(input.code),
    currencyCode: normalizeCurrency(input.currencyCode),
    lines: input.lines
      .map((line) => ({ productId: line.productId, unitPrice: normalizeDecimal(line.unitPrice) }))
      .sort((left, right) => left.productId.localeCompare(right.productId)),
    name: normalizeName(input.name),
    priority: input.priority,
    scope: input.scope,
    ...dates,
    ...targets,
  };
}

function normalizePosCommercialRule(input: CreatePosCommercialRuleRequest) {
  return normalizePosCommercialRuleCore(input);
}

function normalizePosCommercialRuleUpdate(input: UpdatePosCommercialRuleRequest) {
  return {
    ...normalizePosCommercialRuleCore(input),
    active: input.active,
    version: positiveVersion(input.version),
  };
}

function normalizePosCommercialRuleCore(input: CreatePosCommercialRuleRequest) {
  const dates = normalizePeriod(input.validFrom, input.validTo);
  const productIds = input.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length)
    throw new ApiErrorException(
      'SALES_POS_RULE_PRODUCT_DUPLICATE',
      'Each product can appear only once in an offer',
      HttpStatus.BAD_REQUEST,
    );
  if (
    (input.ruleType === 'quantity' && input.items.length !== 1) ||
    (input.ruleType === 'bundle' && input.items.length < 2)
  )
    throw new ApiErrorException(
      'SALES_POS_RULE_ITEMS_INVALID',
      input.ruleType === 'quantity'
        ? 'A quantity offer must contain one product'
        : 'A bundle offer must contain at least two products',
      HttpStatus.BAD_REQUEST,
    );
  const discountValue = positiveDecimal(input.discountValue, 'Discount');
  if (input.discountType === 'percentage' && Number(discountValue) > 100)
    throw new ApiErrorException(
      'SALES_POS_RULE_PERCENTAGE_INVALID',
      'Percentage discounts cannot be greater than 100%',
      HttpStatus.BAD_REQUEST,
    );
  if (!Number.isInteger(input.priority) || input.priority < -1000 || input.priority > 1000)
    throw new ApiErrorException(
      'SALES_POS_RULE_PRIORITY_INVALID',
      'Priority must be a whole number between -1000 and 1000',
      HttpStatus.BAD_REQUEST,
    );
  return {
    code: normalizeCode(input.code),
    discountType: input.discountType,
    discountValue,
    items: input.items
      .map((item) => ({
        productId: item.productId,
        requiredQuantity: positiveDecimal(item.requiredQuantity, 'Required quantity'),
      }))
      .sort((left, right) => left.productId.localeCompare(right.productId)),
    name: normalizeName(input.name),
    priority: input.priority,
    ruleType: input.ruleType,
    ...dates,
  };
}

function normalizeScope(
  scope: PriceListScope,
  customerGroupId: string | undefined,
  customerPartnerId: string | undefined,
) {
  if (scope === 'all_customers') {
    if (customerGroupId || customerPartnerId) throw invalidScope();
    return {};
  }
  if (scope === 'customer_group') {
    if (!customerGroupId || customerPartnerId) throw invalidScope();
    return { customerGroupId };
  }
  if (!customerPartnerId || customerGroupId) throw invalidScope();
  return { customerPartnerId };
}

function invalidScope() {
  return new ApiErrorException(
    'SALES_PRICE_LIST_SCOPE_INVALID',
    'Choose exactly the customer or customer group required by the price-list scope',
    HttpStatus.BAD_REQUEST,
  );
}

function normalizeCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/u.test(normalized))
    throw new ApiErrorException(
      'SALES_PRICING_CODE_INVALID',
      'Code must use letters, numbers, dots, dashes, or underscores',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function normalizeName(value: string) {
  const normalized = value.trim();
  if (!normalized)
    throw new ApiErrorException(
      'SALES_PRICING_NAME_REQUIRED',
      'Name is required',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function normalizePeriod(validFrom: string, validTo: string) {
  const from = normalizeDate(validFrom);
  const to = normalizeDate(validTo);
  if (to < from)
    throw new ApiErrorException(
      'SALES_PRICING_PERIOD_INVALID',
      'The end date cannot be before the start date',
      HttpStatus.BAD_REQUEST,
    );
  return { validFrom: from, validTo: to };
}

function normalizeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new ApiErrorException(
      'SALES_PRICING_DATE_INVALID',
      'Enter a valid date',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function normalizeCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(normalized))
    throw new ApiErrorException(
      'SALES_CURRENCY_INVALID',
      'Currency must use a three-letter code',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function normalizeDecimal(value: string) {
  if (!/^\d+(\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      'SALES_PRICE_INVALID',
      'Price must be a non-negative number with no more than four decimal places',
      HttpStatus.BAD_REQUEST,
    );
  const [whole = '0', fraction = ''] = value.split('.');
  return `${BigInt(whole).toString()}.${fraction.padEnd(4, '0')}`;
}

function positiveDecimal(value: string, label: string) {
  const normalized = normalizeDecimal(value);
  if (Number(normalized) <= 0)
    throw new ApiErrorException(
      'SALES_POS_RULE_VALUE_INVALID',
      `${label} must be greater than zero`,
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)].sort();
}

function positiveVersion(value: number) {
  if (!Number.isInteger(value) || value < 1) throw staleVersion('record');
  return value;
}

function staleVersion(target: string) {
  return new ApiErrorException(
    'SALES_PRICING_VERSION_CONFLICT',
    `The ${target} changed after it was opened. Refresh and try again.`,
    HttpStatus.CONFLICT,
  );
}

function notFound(target: string) {
  return new ApiErrorException(
    'SALES_PRICING_NOT_FOUND',
    `The ${target} was not found`,
    HttpStatus.NOT_FOUND,
  );
}

function validKey(value: string | undefined) {
  const key = value?.trim();
  if (!key || key.length > 200)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required',
      HttpStatus.BAD_REQUEST,
    );
  return key;
}

async function claim(client: PoolClient, scope: string, key: string, hash: string) {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, 'processing', now() + interval '24 hours')
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return null;
  const existing = await client.query<{
    request_hash: string;
    response_body: unknown;
    status: string;
  }>(
    `SELECT request_hash, status, response_body FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (row?.request_hash !== hash || row.status !== 'completed')
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used for another request',
      HttpStatus.CONFLICT,
    );
  return row.response_body;
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
