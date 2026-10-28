import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { BackupController } from './backup.controller.js';
import { BackupMfaGuard } from './backup-mfa.guard.js';
import { BackupService } from './backup.service.js';
import { ObjectStorageModule } from '../storage/object-storage.module.js';
import { BackupDatabaseRecoveryService } from './backup-database-recovery.service.js';
import { PostgresBackupDumpRunner } from './postgres-backup-dump.runner.js';

@Module({
  controllers: [BackupController],
  imports: [AuditModule, DatabaseModule, ObjectStorageModule],
  providers: [
    BackupMfaGuard,
    BackupDatabaseRecoveryService,
    BackupService,
    PostgresBackupDumpRunner,
  ],
})
export class BackupModule {}
