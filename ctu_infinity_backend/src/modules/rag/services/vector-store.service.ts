import { Injectable, OnModuleInit } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { ApiConfigService } from 'src/shared';

import { ChromaClient } from 'chromadb';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private embeddings: OpenAIEmbeddings;
  public vectorStore: Chroma;

  constructor(private readonly apiConfig: ApiConfigService) {
    this.embeddings = new OpenAIEmbeddings({
      apiKey: this.apiConfig.openAiConfig.apiKey,
      model: 'text-embedding-3-small',
    });
  }

  async onModuleInit() {
    // Phân tích URL để truyền chuẩn host, port, ssl (tránh warning 'path' is deprecated)
    const url = new URL(this.apiConfig.chromaConfig.chromaUrl);
    const chromaClient = new ChromaClient({
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80),
      ssl: url.protocol === 'https:',
    });

    this.vectorStore = new Chroma(this.embeddings, {
      index: chromaClient as any,
      collectionName: 'company_documents',
    });

    // Workaround for a bug between @langchain/community and chromadb ^1.x
    // @langchain passes queryEmbeddings as a single 1D array, but chromadb expects a 2D array.
    const originalMethod = this.vectorStore.similaritySearchVectorWithScore.bind(this.vectorStore);
    this.vectorStore.similaritySearchVectorWithScore = async (query: number[], k: number, filter?: any) => {
      return originalMethod([query] as any, k, filter);
    };
  }
}
