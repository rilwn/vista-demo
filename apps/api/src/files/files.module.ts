import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { LoggingModule } from '../logging/logging.module.js';
import { ObjectStorageModule } from '../storage/object-storage.module.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Module({
  controllers: [FilesController],
  exports: [FilesService],
  imports: [AuditModule, DatabaseModule, LoggingModule, ObjectStorageModule],
  providers: [FilesService],
})
export class FilesModule {}
