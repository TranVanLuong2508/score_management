import { Test, TestingModule } from '@nestjs/testing';
import { ChatOpenAI } from '@langchain/openai';
import { RagService } from './rag.service';
import { VectorStoreService } from './services/vector-store.service';
import { ApiConfigService } from 'src/shared';

// Mock ChatOpenAI at module level
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    bind: jest.fn().mockReturnThis(),
  })),
}));

describe('RagService', () => {
  let service: RagService;

  const mockRetrieverInvoke = jest.fn();

  const mockVectorStoreService = {
    isReady: true,
    vectorStore: {
      asRetriever: jest.fn().mockReturnValue({
        invoke: mockRetrieverInvoke,
        pipe: jest.fn().mockReturnThis(),
      }),
    },
  };

  const mockApiConfigService = {
    openAiConfig: {
      apiKey: 'sk-test',
      chatModel: 'gpt-4o-mini',
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: VectorStoreService, useValue: mockVectorStoreService },
        { provide: ApiConfigService, useValue: mockApiConfigService },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('ask', () => {
    it('should return answer and sources when vector store is ready', async () => {
      mockRetrieverInvoke.mockResolvedValueOnce([
        {
          pageContent: 'Quy định điểm rèn luyện: sinh viên được đánh giá...',
          metadata: { source: 'QuyChe.pdf', page: 3 },
        },
      ]);

      const result = await service.ask('Quy định điểm rèn luyện là gì?');

      expect(result.answer).toBeDefined();
      expect(typeof result.answer).toBe('string');
      expect(Array.isArray(result.sources)).toBe(true);
    });

    it('should return fallback answer when vector store is not ready', async () => {
      mockVectorStoreService.isReady = false;

      const result = await service.ask('Quy định điểm rèn luyện là gì?');

      expect(result.answer).toContain('bảo trì');
      expect(result.sources).toEqual([]);
      expect(mockRetrieverInvoke).not.toHaveBeenCalled();

      mockVectorStoreService.isReady = true;
    });

    it('should return fallback on unexpected error', async () => {
      mockRetrieverInvoke.mockRejectedValueOnce(new Error('ChromaDB connection failed'));

      const result = await service.ask('Quy định điểm rèn luyện là gì?');

      expect(result.answer).toContain('lỗi');
      expect(result.sources).toEqual([]);
    });

    it('should deduplicate sources by filename', async () => {
      mockRetrieverInvoke.mockResolvedValueOnce([
        { pageContent: 'Content A', metadata: { source: 'Doc.pdf', page: 1 } },
        { pageContent: 'Content B', metadata: { source: 'Doc.pdf', page: 2 } },
        { pageContent: 'Content C', metadata: { source: 'Other.pdf', page: 3 } },
      ]);

      const result = await service.ask('test question');

      const docSources = result.sources.filter((s) => s.fileName === 'Doc.pdf');
      expect(docSources.length).toBe(1);
      expect(docSources[0].page).toBe(1);

      const otherSources = result.sources.filter((s) => s.fileName === 'Other.pdf');
      expect(otherSources.length).toBe(1);
    });
  });
});
