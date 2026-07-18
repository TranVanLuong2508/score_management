import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { ApiConfigService } from 'src/shared';

import { ChromaClient } from 'chromadb';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private embeddings: OpenAIEmbeddings;
  private _vectorStore: Chroma | null = null;

  public get vectorStore(): Chroma {
    if (!this._vectorStore) {
      throw new Error('VectorStore chưa được khởi tạo. Kiểm tra kết nối ChromaDB.');
    }
    return this._vectorStore;
  }

  public get isReady(): boolean {
    return this._vectorStore !== null;
  }

  constructor(private readonly apiConfig: ApiConfigService) {
    this.embeddings = new OpenAIEmbeddings({
      apiKey: this.apiConfig.openAiConfig.apiKey,
      model: 'text-embedding-3-small',
    });
  }

  async onModuleInit() {
    try {
      const url = new URL(this.apiConfig.chromaConfig.chromaUrl);
      const chromaClient = new ChromaClient({
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80,
        ssl: url.protocol === 'https:',
      });

      this._vectorStore = new Chroma(this.embeddings, {
        index: chromaClient as any,
        collectionName: 'company_documents',
      });

      // Verify connection bằng cách list collections
      await chromaClient.listCollections();

      // Workaround for a bug between @langchain/community and chromadb ^1.x
      // @langchain passes queryEmbeddings as a single 1D array, but chromadb expects a 2D array.
      const originalMethod = this._vectorStore.similaritySearchVectorWithScore.bind(this._vectorStore);
      this._vectorStore.similaritySearchVectorWithScore = async (
        query: number[],
        k: number,
        filter?: any,
      ) => {
        return originalMethod([query] as any, k, filter);
      };

      this.logger.log('VectorStoreService: ChromaDB connected successfully');
    } catch (error) {
      this.logger.warn(
        `[VectorStoreService] Không thể kết nối ChromaDB: ${error.message}. ` +
          'RAG features sẽ không hoạt động.',
      );
      // KHÔNG throw — app vẫn start được
    }
  }
}
