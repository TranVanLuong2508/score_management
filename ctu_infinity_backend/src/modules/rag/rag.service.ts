import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { VectorStoreService } from './services/vector-store.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { formatDocumentsAsString } from 'langchain/util/document';
import { ApiConfigService } from 'src/shared';

export type Source = {
  fileName: string;
  page?: number;
};

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private llm: ChatOpenAI;

  constructor(
    private readonly vectorStoreService: VectorStoreService,
    private readonly apiConfig: ApiConfigService,
  ) {
    this.llm = new ChatOpenAI({
      apiKey: this.apiConfig.openAiConfig.apiKey,
      model: this.apiConfig.openAiConfig.chatModel,
      temperature: 0.2,
    });
  }

  async ask(question: string): Promise<{ answer: string; sources: Source[] }> {
    if (!this.vectorStoreService.isReady) {
      this.logger.warn('VectorStore chưa sẵn sàng, trả lời fallback');
      return {
        answer:
          'Xin lỗi, hệ thống tài liệu đang bảo trì. Bạn có thể hỏi về thông tin cá nhân hoặc sự kiện thay thế.',
        sources: [],
      };
    }

    try {
      const retriever = this.vectorStoreService.vectorStore.asRetriever({ k: 6 });

      // ─── Lấy docs trước để trích nguồn ───
      const retrievedDocs = await retriever.invoke(question);

      const prompt = ChatPromptTemplate.fromTemplate(`
Bạn là trợ lý AI chuyên tư vấn thông tin tuyển dụng, giúp ứng viên tìm hiểu về các quy định, chính sách, quy chế, xếp loại đánh giá điểm rèn luyện và các quy định liên quan trong công tác học vụ của CTU (Đại học Cần Thơ).

Quy tắc QUAN TRỌNG:
1. Trả lời DỰA HOÀN TOÀN trên ngữ cảnh được cung cấp bên dưới. KHÔNG bịa đặt thông tin.
2. Nếu ngữ cảnh không đủ để trả lời, hãy nói rõ: "Tôi không tìm thấy thông tin này trong tài liệu."
3. Trả lời bằng TIẾNG VIỆT, rõ ràng và có cấu trúc (dùng gạch đầu dòng hoặc tiêu đề khi cần).
4. Khi đề cập tên công ty hoặc vị trí, hãy dùng ĐÚNG tên trong tài liệu (không được suy đoán).
5. Nếu câu hỏi hỏi về một mục cụ thể (ví dụ: điểm rèn luyện từng tiêu chí, cách xếp hạng dựa trên điểm số, các quy định cụ thể, ...), chỉ trả lời phần đó.

Ngữ cảnh từ tài liệu:
{context}

Câu hỏi: {question}

Câu trả lời:
`);

      const chain = RunnableSequence.from([
        {
          context: retriever.pipe(formatDocumentsAsString),
          question: new RunnablePassthrough(),
        },
        prompt,
        this.llm,
        new StringOutputParser(),
      ]);

      const answer = await chain.invoke(question);

      // ─── Trích nguồn từ metadata ───
      const sourceSet = new Map<string, number>();
      for (const doc of retrievedDocs) {
        const fileName = (doc.metadata?.source as string) ?? 'unknown';
        const page = doc.metadata?.page as number | undefined;
        if (!sourceSet.has(fileName)) {
          sourceSet.set(fileName, page ?? 0);
        }
      }

      const sources: Source[] = Array.from(sourceSet.entries()).map(([fileName, page]) => ({
        fileName,
        page: page > 0 ? page : undefined,
      }));

      return { answer, sources };
    } catch (error) {
      this.logger.error(`RAG ask failed: ${error.message}`, error.stack);
      return {
        answer: 'Đã xảy ra lỗi khi truy xuất tài liệu. Vui lòng thử lại.',
        sources: [],
      };
    }
  }
}
