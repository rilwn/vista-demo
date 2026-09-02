import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';
import {
  crmAnalyticsPipelineStages,
  crmAnalyticsRevenueDimensions,
  type CrmAnalyticsCustomerMetrics,
  type CrmAnalyticsDefinition,
  type CrmAnalyticsEmployeeMetric,
  type CrmAnalyticsOverview,
  type CrmAnalyticsPipelineMetrics,
  type CrmAnalyticsPipelineStageMetric,
  type CrmAnalyticsPreference,
  type CrmAnalyticsRevenueMetric,
} from '@vista/contracts';

export class CrmAnalyticsQueryDto {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  dateFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString({ strict: true })
  dateTo!: string;
}

export class CrmAnalyticsCustomerMetricsDto implements CrmAnalyticsCustomerMetrics {
  @ApiProperty({ minimum: 0, type: Number }) activeCustomers!: number;
  @ApiProperty({ example: '60.00', type: String }) averageTransactionValueBgn!: string;
  @ApiProperty({ example: '0.00', type: String }) churnPercent!: string;
  @ApiProperty({ example: '60.00', type: String }) observedLifetimeValueBgn!: string;
  @ApiProperty({ example: '1.00', type: String }) purchaseFrequency!: string;
  @ApiProperty({ example: '100.00', type: String }) retentionPercent!: string;
}

export class CrmAnalyticsPipelineStageMetricDto implements CrmAnalyticsPipelineStageMetric {
  @ApiProperty({ example: '100.00', required: false, type: String })
  conversionFromPreviousPercent?: string;
  @ApiProperty({ minimum: 0, type: Number }) currentCount!: number;
  @ApiProperty({ minimum: 0, type: Number }) enteredCount!: number;
  @ApiProperty({ enum: crmAnalyticsPipelineStages })
  stage!: CrmAnalyticsPipelineStageMetric['stage'];
}

export class CrmAnalyticsPipelineMetricsDto implements CrmAnalyticsPipelineMetrics {
  @ApiProperty({ minimum: 0, type: Number }) createdOpportunities!: number;
  @ApiProperty({ example: '1250.00', type: String }) estimatedRevenueBgn!: string;
  @ApiProperty({ minimum: 0, type: Number }) lostCount!: number;
  @ApiProperty({ example: '1250.00', type: String }) openPipelineValueBgn!: string;
  @ApiProperty({ type: [CrmAnalyticsPipelineStageMetricDto] })
  stages!: CrmAnalyticsPipelineStageMetric[];
  @ApiProperty({ example: '50.00', type: String }) winRatePercent!: string;
  @ApiProperty({ minimum: 0, type: Number }) wonCount!: number;
}

export class CrmAnalyticsEmployeeMetricDto implements CrmAnalyticsEmployeeMetric {
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ minimum: 0, type: Number }) requestsProcessed!: number;
  @ApiProperty({ minimum: 0, type: Number }) salesCompleted!: number;
  @ApiProperty({ minimum: 0, type: Number }) ticketsResolved!: number;
  @ApiProperty({ minimum: 0, type: Number }) totalCompleted!: number;
}

export class CrmAnalyticsPreferenceDto implements CrmAnalyticsPreference {
  @ApiProperty({ minimum: 0, type: Number }) documentCount!: number;
  @ApiProperty({ enum: ['product', 'service'] }) kind!: CrmAnalyticsPreference['kind'];
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ example: '60.00', type: String }) netRevenueBgn!: string;
  @ApiProperty({ example: '1.0000', type: String }) quantity!: string;
}

export class CrmAnalyticsRevenueMetricDto implements CrmAnalyticsRevenueMetric {
  @ApiProperty({ enum: crmAnalyticsRevenueDimensions })
  dimension!: CrmAnalyticsRevenueMetric['dimension'];
  @ApiProperty({ minimum: 0, type: Number }) documentCount!: number;
  @ApiProperty({ type: String }) key!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ example: '60.00', type: String }) netRevenueBgn!: string;
  @ApiProperty({ example: '100.00', type: String }) sharePercent!: string;
}

export class CrmAnalyticsDefinitionDto implements CrmAnalyticsDefinition {
  @ApiProperty({ isArray: true, type: String }) dataSources!: string[];
  @ApiProperty({ type: String }) dateWindow!: string;
  @ApiProperty({ type: String }) formula!: string;
  @ApiProperty({ type: String }) key!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ isArray: true, type: String }) statusFilters!: string[];
}

export class CrmAnalyticsOverviewDto implements CrmAnalyticsOverview {
  @ApiProperty({ type: CrmAnalyticsCustomerMetricsDto })
  customerMetrics!: CrmAnalyticsCustomerMetrics;
  @ApiProperty({ format: 'date', type: String }) dateFrom!: string;
  @ApiProperty({ format: 'date', type: String }) dateTo!: string;
  @ApiProperty({ type: [CrmAnalyticsDefinitionDto] }) definitions!: CrmAnalyticsDefinition[];
  @ApiProperty({ type: [CrmAnalyticsEmployeeMetricDto] }) employees!: CrmAnalyticsEmployeeMetric[];
  @ApiProperty({ format: 'date-time', type: String }) generatedAt!: string;
  @ApiProperty({ type: CrmAnalyticsPipelineMetricsDto }) pipeline!: CrmAnalyticsPipelineMetrics;
  @ApiProperty({ type: [CrmAnalyticsPreferenceDto] }) preferences!: CrmAnalyticsPreference[];
  @ApiProperty({ type: CrmAnalyticsCustomerMetricsDto })
  previousCustomerMetrics!: CrmAnalyticsCustomerMetrics;
  @ApiProperty({ format: 'date', type: String }) previousDateFrom!: string;
  @ApiProperty({ format: 'date', type: String }) previousDateTo!: string;
  @ApiProperty({ type: [CrmAnalyticsRevenueMetricDto] }) revenue!: CrmAnalyticsRevenueMetric[];
  @ApiProperty({ example: '60.00', type: String }) totalNetRevenueBgn!: string;
  @ApiProperty({ example: 'Europe/Sofia', type: String }) timezone!: string;
}
