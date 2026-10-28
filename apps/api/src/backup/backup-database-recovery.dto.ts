import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString, Length } from 'class-validator';

import type {
  BackupDatabaseRecordRecovery,
  BackupDatabaseRecordRecoveryRequest,
  BackupDatabaseRecoveryTable,
  BackupDatabaseRecoveryTablePage,
} from '@vista/contracts';

export class BackupDatabaseRecoveryTableDto implements BackupDatabaseRecoveryTable {
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ isArray: true, type: String }) primaryKeyColumns!: string[];
}

export class BackupDatabaseRecoveryTablePageDto implements BackupDatabaseRecoveryTablePage {
  @ApiProperty({ isArray: true, type: BackupDatabaseRecoveryTableDto })
  items!: BackupDatabaseRecoveryTableDto[];
}

export class BackupDatabaseRecordRecoveryRequestDto implements BackupDatabaseRecordRecoveryRequest {
  @ApiProperty({ type: String })
  @IsString()
  @Length(3, 257)
  tableName!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  @IsObject()
  primaryKey!: Record<string, string>;
}

export class BackupDatabaseRecordRecoveryDto implements BackupDatabaseRecordRecovery {
  @ApiProperty({ enum: ['vista-database-record-recovery-v1'] })
  format!: 'vista-database-record-recovery-v1';

  @ApiProperty({ enum: ['mariadb', 'postgresql'] })
  databaseEngine!: 'mariadb' | 'postgresql';

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  primaryKey!: Record<string, string>;

  @ApiProperty({ type: String, format: 'date-time' })
  recoveredAt!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  record!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'uuid' })
  restoreRequestId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceRunId!: string;

  @ApiProperty({ type: String })
  tableName!: string;
}
