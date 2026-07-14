import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { IngestionService } from './services/ingestion.service';
import { VectorStoreService } from './services/vector-store.service';

@Module({
  controllers: [RagController],
  providers: [RagService, IngestionService, VectorStoreService],
  exports: [RagService],
})
export class RagModule {}
