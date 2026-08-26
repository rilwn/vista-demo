import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';
import type {
  ServiceReportOverview,
  ServiceReportStatusTotal,
  ServiceReportTypeTotal,
  ServiceTechnicianPerformance,
} from '@vista/contracts';

export class ServiceReportQueryDto {
  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ format: 'date', type: String })
  @IsDateString()
  dateTo!: string;
}

class ServiceReportStatusTotalDto implements ServiceReportStatusTotal {
  @ApiProperty({ minimum: 0, type: Number }) count!: number;
  @ApiProperty({ enum: ['new', 'scheduled', 'in_progress', 'completed', 'cancelled'] })
  status!: ServiceReportStatusTotal['status'];
}

class ServiceReportTypeTotalDto implements ServiceReportTypeTotal {
  @ApiProperty({ minimum: 0, type: Number }) completedCount!: number;
  @ApiProperty({ minimum: 0, type: Number }) requestCount!: number;
  @ApiProperty({ enum: ['warranty', 'out_of_warranty', 'subscription'] })
  serviceType!: ServiceReportTypeTotal['serviceType'];
  @ApiProperty({ type: String }) totalCostBgn!: string;
}

class ServiceTechnicianPerformanceDto implements ServiceTechnicianPerformance {
  @ApiProperty({ minimum: 0, type: Number }) assignedCount!: number;
  @ApiProperty({ minimum: 0, type: Number }) completedCount!: number;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ minimum: 0, type: Number }) laborMinutes!: number;
  @ApiProperty({ type: String }) totalCostBgn!: string;
}

class ServiceReportTotalsDto {
  @ApiProperty({ minimum: 0, type: Number }) cancelledRequests!: number;
  @ApiProperty({ minimum: 0, type: Number }) completedRequests!: number;
  @ApiProperty({ minimum: 0, type: Number }) laborMinutes!: number;
  @ApiProperty({ minimum: 0, type: Number }) openRequests!: number;
  @ApiProperty({ type: String }) totalCostBgn!: string;
  @ApiProperty({ minimum: 0, type: Number }) totalRequests!: number;
}

export class ServiceReportOverviewDto implements ServiceReportOverview {
  @ApiProperty({ format: 'date', type: String }) dateFrom!: string;
  @ApiProperty({ format: 'date', type: String }) dateTo!: string;
  @ApiProperty({ format: 'date-time', type: String }) generatedAt!: string;
  @ApiProperty({ type: [ServiceReportStatusTotalDto] })
  statusTotals!: ServiceReportStatusTotal[];
  @ApiProperty({ type: [ServiceTechnicianPerformanceDto] })
  technicians!: ServiceTechnicianPerformance[];
  @ApiProperty({ type: ServiceReportTotalsDto }) totals!: ServiceReportOverview['totals'];
  @ApiProperty({ type: [ServiceReportTypeTotalDto] }) typeTotals!: ServiceReportTypeTotal[];
}
