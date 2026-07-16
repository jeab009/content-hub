import { Module } from '@nestjs/common';
import { CopyrightGateService } from './copyright-gate.service';

/**
 * Phase 1.5 scope: this module exists only to make `CopyrightGateService`
 * available via Nest DI ahead of Phase 2, which will add a
 * `ContentController` and wire the pre-existing `ContentService` (upload +
 * CRUD, see content.service.ts) into this module's providers/controllers.
 * Deliberately registers no controller — no new API surface this
 * iteration.
 */
@Module({
  providers: [CopyrightGateService],
  exports: [CopyrightGateService],
})
export class ContentModule {}
