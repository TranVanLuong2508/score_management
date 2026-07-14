import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { VectorStoreService } from './services/vector-store.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { formatDocumentsAsString } from 'langchain/util/document';
import { ApiConfigService } from 'src/shared';

@Injectable()
export class RagService {
  private llm: ChatOpenAI;

  constructor(
    private readonly vectorStoreService: VectorStoreService,
    private readonly apiConfig: ApiConfigService,
  ) {
    this.llm = new ChatOpenAI({
      apiKey: this.apiConfig.openAiConfig.apiKey,
      model: this.apiConfig.openAiConfig.chatModel, // đọc từ OPENAI_CHAT_MODEL env
      temperature: 0.2,
    });
  }

  async ask(question: string) {
    const retriever = this.vectorStoreService.vectorStore.asRetriever({
      k: 6, // Tăng từ 4 → 6 để capture đủ nội dung JD dài
    });

    const prompt = ChatPromptTemplate.fromTemplate(`
Bạn là trợ lý AI chuyên tư vấn thông tin tuyển dụng, giúp ứng viên tìm hiểu về các vị trí công việc.

Quy tắc QUAN TRỌNG:
1. Trả lời DỰA HOÀN TOÀN trên ngữ cảnh được cung cấp bên dưới. KHÔNG bịa đặt thông tin.
2. Nếu ngữ cảnh không đủ để trả lời, hãy nói rõ: "Tôi không tìm thấy thông tin này trong tài liệu."
3. Trả lời bằng TIẾNG VIỆT, rõ ràng và có cấu trúc (dùng gạch đầu dòng hoặc tiêu đề khi cần).
4. Khi đề cập tên công ty hoặc vị trí, hãy dùng ĐÚNG tên trong tài liệu (không được suy đoán).
5. Nếu câu hỏi hỏi về một mục cụ thể (ví dụ: yêu cầu kỹ năng, phúc lợi, mức lương...), chỉ trả lời phần đó.

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
    return { answer };
  }
}
