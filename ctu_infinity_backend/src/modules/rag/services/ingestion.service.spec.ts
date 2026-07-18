import { Test, TestingModule } from '@nestjs/testing';
import { IngestionService } from './ingestion.service';
import { VectorStoreService } from './vector-store.service';
import { ApiConfigService } from 'src/shared';

describe('IngestionService', () => {
  let service: IngestionService;

  const mockVectorStoreService = {
    isReady: true,
    vectorStore: {
      addDocuments: jest.fn(),
    },
  };

  const mockApiConfigService = {
    chromaConfig: { chromaUrl: 'http://localhost:8000' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionService,
        { provide: VectorStoreService, useValue: mockVectorStoreService },
        { provide: ApiConfigService, useValue: mockApiConfigService },
      ],
    }).compile();

    service = module.get<IngestionService>(IngestionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await (service as any).withRetry(fn, 3, 100);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail once'))
        .mockResolvedValueOnce('success');

      const result = await (service as any).withRetry(fn, 3, 10);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries exceeded', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fail'));

      await expect((service as any).withRetry(fn, 3, 10)).rejects.toThrow('always fail');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('ingestText', () => {
    it('should throw when vector store not ready', async () => {
      mockVectorStoreService.isReady = false;

      await expect(service.ingestText('some text')).rejects.toThrow('VectorStore chưa sẵn sàng');

      mockVectorStoreService.isReady = true;
    });

    it('should add documents when vector store is ready', async () => {
      mockVectorStoreService.vectorStore.addDocuments.mockResolvedValue(undefined);

      const result = await service.ingestText('Test document content', { source: 'test' });

      expect(result.chunksAdded).toBeGreaterThanOrEqual(0);
      expect(mockVectorStoreService.vectorStore.addDocuments).toHaveBeenCalled();
    });
  });
});
