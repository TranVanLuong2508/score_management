# Chatbot RAG — Tài Liệu Kỹ Thuật

> Nguồn: phân tích trực tiếp từ source code NestJS backend (`ctu_infinity_backend`) và React client (`ctu_infinity_client`).

---

## 1. Tổng Quan

Chatbot là một AI assistant đa năng trong hệ thống **CTU Infinity**, được xây dựng trên kiến trúc **Multi-Intent RAG** (Retrieval Augmented Generation). Chatbot xử lý nhiều loại intent khác nhau, trong đó intent `ask_documents` sử dụng cơ chế RAG để truy xuất và trả lời câu hỏi dựa trên tài liệu quy định nội bộ.

### Các thành phần chính

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| RAG Vector Store | ChromaDB | Lưu trữ vector embeddings |
| Embedding Model | OpenAI `text-embedding-3-small` | Chuyển text → vector |
| LLM cho RAG | OpenAI Chat API (`gpt-4o-mini`) | Sinh câu trả lời |
| LLM cho Intent | OpenAI Chat API (`gpt-4o-mini`) | Phân loại ý định user |
| Backend | NestJS + LangChain.js | Xử lý nghiệp vụ |
| Frontend | React + Zustand | Giao diện chat |

---

## 2. Kiến Trúc Module

```
ctu_infinity_backend/src/modules/rag/
├── rag.module.ts                # Module definition
├── rag.controller.ts           # HTTP endpoints
├── rag.service.ts              # RAG: retrieval + LLM answer
├── rag.dto.ts                  # DTOs: AskQuestionDto, IngestTextDto
├── company-docs/               # Thư mục chứa file PDF gốc
└── services/
    ├── vector-store.service.ts  # Kết nối ChromaDB + Embedding
    └── ingestion.service.ts     # Ingest tài liệu vào vector store
```

---

## 3. Chi Tiết Từng File

### 3.1. `vector-store.service.ts`

**Đường dẫn:** `ctu_infinity_backend/src/modules/rag/services/vector-store.service.ts`

**Class:** `VectorStoreService`

**Interface:** `OnModuleInit` (khởi tạo khi module load)

#### Thuộc tính

| Thuộc tính | Kiểu | Mô tả |
|---|---|---|
| `embeddings` | `OpenAIEmbeddings` | Model embedding, dùng `text-embedding-3-small` |
| `_vectorStore` | `Chroma` \| `null` | Vector store instance, null nếu ChromaDB chưa kết nối |

#### Hàm `onModuleInit()`

```typescript
async onModuleInit() {
    const chromaClient = new ChromaClient({ host: "http://localhost:8000" });
    this._vectorStore = new Chroma(this.embeddings, {
        collectionName: 'company_documents',
    });
}
```

**Vai trò:** Khi server khởi động, hàm này tự động kết nối tới ChromaDB và khởi tạo vector store. Nếu ChromaDB offline, server vẫn start bình thường (chỉ log warning).

#### Getter `vectorStore`

```typescript
public get vectorStore(): Chroma {
    if (!this._vectorStore) {
        throw new Error('VectorStore chưa được khởi tạo...');
    }
    return this._vectorStore;
}
```

#### Getter `isReady`

```typescript
public get isReady(): boolean {
    return this._vectorStore !== null;
}
```

#### Workaround ChromaDB bug

```typescript
// @langchain/community gửi 1D array, nhưng chromadb ^1.x cần 2D array
this._vectorStore.similaritySearchVectorWithScore = async (query, k, filter) => {
    return originalMethod([query] as any, k, filter);
};
```

---

### 3.2. `ingestion.service.ts`

**Đường dẫn:** `ctu_infinity_backend/src/modules/rag/services/ingestion.service.ts`

**Class:** `IngestionService`

**Interface:** `OnModuleInit`

#### Hằng số

```typescript
private readonly COMPANY_DOCS_DIR = path.resolve(
    process.cwd(), 'src', 'modules', 'rag', 'company-docs'
);
```

Thư mục chứa file PDF nguồn để ingest. Khi server start, hàm `onModuleInit()` sẽ tự động gọi `ingestCompanyDocs()` nếu ChromaDB online.

#### Hàm `splitText()`

```typescript
private async splitText(texts: string[], metadatas: Record<string, any>[]): Promise<Document[]> {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1500,    // ký tự / chunk
        chunkOverlap: 200,  // overlap giữa các chunk
    });
    return splitter.createDocuments(texts, metadatas);
}
```

**Vai trò:** Chia text thành các đoạn nhỏ (chunk) để:
- Phù hợp với context window của LLM
- Tăng độ chính xác khi retrieval (mỗi chunk là một unit truy xuất)
- `chunkOverlap=200` giúp context không bị cắt đứt câu

#### Hàm `loadPdf()`

```typescript
private async loadPdf(filePath: string, metadata: Record<string, any> = {}): Promise<Document[]> {
    const loader = new PDFLoader(filePath, { splitPages: true });
    const rawDocs = await loader.load();
    // Làm sạch metadata, chỉ giữ kiểu primitive
    // Gắn page number vào metadata
    // → gọi splitText()
}
```

**Vai trò:** Đọc file PDF bằng `PDFLoader`, trích metadata (page number), sau đó gọi `splitText()` để chia chunk.

#### Hàm `isAlreadyIngested()`

```typescript
private async isAlreadyIngested(chromaClient: ChromaClient, fileName: string): Promise<boolean> {
    const result = await collection.get({ where: { source: fileName }, limit: 1 });
    return result.ids.length > 0;
}
```

**Vai trò:** Kiểm tra file PDF đã tồn tại trong ChromaDB chưa, tránh duplicate khi server restart.

#### Hàm `ingestCompanyDocs()`

```typescript
async ingestCompanyDocs(): Promise<{ filesProcessed: number; chunksAdded: number }> {
    // 1. Đọc tất cả file PDF trong company-docs/
    // 2. Kiểm tra isAlreadyIngested()
    // 3. loadPdf() → splitText()
    // 4. vectorStore.addDocuments()
    // Retry 3 lần nếu thất bại, delay tăng dần (1000ms × attempt)
}
```

**Vai trò:** Ingest tất cả PDF có sẵn trong thư mục. Có deduplication và retry logic.

#### Hàm `ingestUploadedPdf()`

```typescript
async ingestUploadedPdf(file: any): Promise<{ fileName: string; chunksAdded: number; message: string }> {
    // 1. Lưu file vào ổ cứng tại company-docs/
    // 2. isAlreadyIngested() check
    // 3. loadPdf() → splitText() → addDocuments()
}
```

**Vai trò:** Xử lý file PDF upload từ client. Vừa lưu file, vừa ingest vào vector store.

#### Hàm `resetAndIngest()`

```typescript
async resetAndIngest(): Promise<{ deleted: boolean; filesProcessed: number; chunksAdded: number }> {
    // 1. Xóa collection 'company_documents'
    // 2. Gọi lại ingestCompanyDocs()
}
```

**Vai trò:** Reset toàn bộ vector store rồi ingest lại từ đầu. Dùng khi cần fix metadata hoặc tránh duplicate.

#### Hàm `getStats()`

```typescript
async getStats(): Promise<{ totalChunks: number; bySource: Record<string, number> }> {
    // Đếm số chunks, group theo file nguồn
}
```

**Vai trò:** Thống kê số chunks đã ingest, phục vụ debug/monitoring.

#### Hàm `withRetry()`

```typescript
private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3, delayMs = 1000): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try { return await fn(); }
        catch (error) {
            if (i < maxRetries - 1)
                await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        }
    }
    throw lastError!;
}
```

**Vai trò:** Retry logic chung, dùng cho mọi thao tác ChromaDB có thể thất bại tạm thời.

---

### 3.3. `rag.service.ts`

**Đường dẫn:** `ctu_infinity_backend/src/modules/rag/rag.service.ts`

**Class:** `RagService`

#### Hàm `ask()`

```typescript
async ask(question: string): Promise<{ answer: string; sources: Source[] }> {
    // 1. Kiểm tra vectorStore sẵn sàng
    // 2. Tạo retriever với k=6 (lấy top-6 chunks)
    // 3. Retrieval: retriever.invoke(question)
    // 4. Gắn context vào prompt template
    // 5. LLM sinh câu trả lời
    // 6. Trích nguồn từ metadata (fileName, page)
}
```

**Chi tiết prompt:**



```
Bạn là trợ lý AI chuyên tư vấn thông tin tuyển dụng, giúp ứng viên tìm hiểu về
các quy định, chính sách, quy chế, xếp loại đánh giá điểm rèn luyện và các
quy định liên quan trong công tác học vụ của CTU (Đại học Cần Thơ).

Quy tắc QUAN TRỌNG:
1. Trả lời DỰA HOÀN TOÀN trên ngữ cảnh được cung cấp. KHÔNG bịa đặt.
2. Nếu ngữ cảnh không đủ → nói rõ: "Tôi không tìm thấy thông tin này trong tài liệu."
3. Trả lời TIẾNG VIỆT, có cấu trúc.
4. Khi đề cập tên công ty/vị trí → dùng ĐÚNG tên trong tài liệu.
```

**Prompt chain (LangChain RunnableSequence):**

```typescript
RunnableSequence.from([
    {
        context: retriever.pipe(formatDocumentsAsString),  // chunks → string
        question: new RunnablePassthrough(),
    },
    prompt,     // template với {context} + {question}
    this.llm,   // ChatOpenAI(temperature: 0.2)
    new StringOutputParser(),
]);
```

**Trích nguồn (sources):**

```typescript
const sourceSet = new Map<string, number>();
for (const doc of retrievedDocs) {
    const fileName = doc.metadata?.source as string;
    const page = doc.metadata?.page as number | undefined;
    if (!sourceSet.has(fileName)) {
        sourceSet.set(fileName, page ?? 0);
    }
}
// Trả về: [{ fileName: "quy-che.pdf", page: 3 }, ...]
```

---

### 3.4. `rag.controller.ts`

**Đường dẫn:** `ctu_infinity_backend/src/modules/rag/rag.controller.ts`

**Class:** `RagController`

**Guard:** `ThrottlerGuard` (rate limiting toàn bộ controller)

| Endpoint | Method | Decorator | Mô tả |
|---|---|---|---|
| `/rag/ingest` | POST | — | Ingest raw text |
| `/rag/ask` | POST | `@Throttle({ rag: { ttl: 60_000, limit: 15 } })` | Trả lời câu hỏi (15 req/phút) |
| `/rag/upload-doc` | POST | `FileInterceptor('file')` | Upload PDF + auto ingest |
| `/rag/ingest-docs` | POST | `@Public()` | Re-index toàn bộ company-docs |
| `/rag/reset-docs` | POST | `@Public()` | Reset + re-index |
| `/rag/stats` | GET | `@Public()` | Thống kê chunks |

**Rate limit** cho `/rag/ask`: 15 request / 60 giây / IP.

---

### 3.5. `chatbot.service.ts` — Tích hợp RAG

**Đường dẫn:** `ctu_infinity_backend/src/modules/chatbot/chatbot.service.ts`

#### Luồng xử lý chính: `handleChat()`

```typescript
async handleChat(userId: string, question: string) {
    // 1. Lấy lịch sử hội thoại (tối đa 10 bản ghi)
    const history = await conversationRepo.find({ where: { userId }, take: 10 });

    // 2. Phân tích intent bằng LLM
    const intent = await this.analyzeIntent(question, history);

    // 3. Xử lý theo intent
    switch (intent.intent) {
        case 'ask_documents':
            data = await this.getDocumentAnswer(question);  // ← GỌI RAG
            break;
        // ... các intent khác
    }

    // 4. LLM tạo câu trả lời tự nhiên
    answer = await this.buildAnswer(question, intent.intent, data);

    // 5. Lưu lịch sử
    await conversationRepo.save([userMsg, botMsg]);

    return answer;
}
```

#### Intent `ask_documents`: `getDocumentAnswer()`

```typescript
private async getDocumentAnswer(question: string) {
    try {
        const result = await this.ragService.ask(question);  // ← Gọi RagService
        return {
            answer: result.answer,
            sources: result.sources ?? [],  // [{ fileName, page }]
        };
    } catch (error) {
        return {
            answer: 'Xin lỗi, tôi không thể truy xuất tài liệu lúc này.',
            sources: [],
        };
    }
}
```

#### Phân tích intent: `analyzeIntent()`

```typescript
private async analyzeIntent(question: string, history: ConversationHistory[]): Promise<IntentAnalysis> {
    // Prompt gửi kèm lịch sử hội thoại
    // Trả về JSON: { intent, keyword, criteriaCode, categoryName }
    const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,  // deterministic
        response_format: { type: 'json_object' },
    });
    return JSON.parse(completion.choices[0].message.content ?? '{}');
}
```

8 intent được nhận diện: `ask_my_info`, `ask_my_scores`, `ask_my_events`, `ask_system_events`, `ask_suggested_events`, `ask_documents`, `thanks_you`, `unknown`.

---

### 3.6. `chatbotStore.ts` — Frontend (React + Zustand)

**Đường dẫn:** `ctu_infinity_client/src/stores/chatbotStore.ts`

#### State

```typescript
interface IChatbotState {
    isOpen: boolean;       // Widget mở/đóng
    isLoading: boolean;    // Đang chờ bot trả lời
    messages: IChatMessage[];  // Lịch sử tin nhắn
    inputValue: string;    // Input hiện tại
}
```

#### Action `sendMessage()`

```typescript
sendMessage: async (message: string) => {
    // 1. Thêm user message vào store
    set({ messages: [...messages, userMsg], isLoading: true });

    // 2. Gọi API /chatbot/chat
    const res = await chatbotService.chat({ question: message });

    // 3. Trích eventLinks từ response
    const eventLinks = (res?.data as any)?.eventLinks ?? [];
    const answerWithLinks = `${answer}\n\nLink sự kiện:\n${eventLinks.map(...)}`;

    // 4. Thêm bot message vào store
    set({ messages: [...messages, botMsg], isLoading: false });
}
```

**Hàm `extractEventLinks()`**: Duyệt đệ quy response JSON, trích các trường `eventUrl` và `eventName` bất kể cấu trúc nested nào.

---

## 4. Luồng RAG Hoàn Chỉnh

```
USER nhập: "Cách xếp loại điểm rèn luyện như thế nào?"
        │
        ▼
┌─────────────────────────────────────────────────┐
│  chatbot.service.ts — analyzeIntent()             │
│  → intent = "ask_documents"                       │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  chatbot.service.ts — getDocumentAnswer()         │
│  → ragService.ask(question)                       │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  rag.service.ts — ask()                           │
│                                                 │
│  1. retriever.invoke(question)                  │
│     ↓ ChromaDB similarity search (k=6)           │
│     ↓ vector = embed(question) [text-embedding-3-small]│
│     ↓ top-6 chunks được trả về                   │
│                                                 │
│  2. Prompt: {context} + {question} → LLM         │
│                                                 │
│  3. LLM (gpt-4o-mini, temperature=0.2)          │
│     → câu trả lời tiếng Việt dựa trên context   │
│                                                 │
│  4. Trích nguồn: [{ fileName, page }] từ metadata│
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  chatbot.service.ts — buildAnswer()               │
│  → LLM định dạng lại câu trả + gắn eventLinks   │
└────────────────────┬──────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  chatbotStore (Zustand)                          │
│  → Thêm bot message + isLoading = false          │
└─────────────────────────────────────────────────┘
```

---

## 5. Quy Trình Ingest Tài Liệu

### 5.1. Ingest tự động khi server start

```
Module RAG khởi động
        │
        ▼
IngestionService.onModuleInit()
        │
        ├── ChromaDB online? ──No──▶ Bỏ qua, log warning
        │
        └── Yes
            │
            ▼
    ingestCompanyDocs()
            │
            ├── Đọc file PDF trong company-docs/
            ├── isAlreadyIngested() check (deduplication)
            ├── loadPdf() → PDFLoader → raw pages
            ├── splitText() → RecursiveCharacterTextSplitter
            │              (chunkSize=1500, overlap=200)
            ├── vectorStore.addDocuments()
            │   └── ChromaDB: text → embed → lưu vector
            └── Log: "Ingest X.pdf → Y chunks"
```

### 5.2. Ingest thủ công qua API

```
Admin upload PDF → POST /rag/upload-doc
        │
        ▼
ingestionService.ingestUploadedPdf(file)
        │
        ├── Lưu file vào company-docs/
        ├── isAlreadyIngested() check
        ├── loadPdf() → splitText()
        └── addDocuments()
```

---

## 6. Lưu Trữ Dữ Liệu

### ChromaDB Collection

| Trường | Kiểu | Mô tả |
|---|---|---|
| `id` | string | Auto-generated UUID |
| `embedding` | float[] | Vector 1536 chiều (`text-embedding-3-small`) |
| `document` | string | Nội dung chunk text |
| `metadata.source` | string | Tên file PDF nguồn |
| `metadata.page` | number | Số trang trong PDF |

### Cấu hình trong `api-config.service.ts`

```typescript
get chromaConfig() {
    return { chromaUrl: getString('CHROMA_HOST') };  // VD: http://localhost:8000
}

get openAiConfig() {
    return {
        apiKey: getString('OPENAI_API_KEY'),
        chatModel: 'gpt-4o-mini',
    };
}
```

---

## 7. Điểm Mạnh

1. **Kiến trúc modular rõ ràng:** Tách biệt rõ ràng giữa `VectorStoreService` (kết nối), `IngestionService` (xử lý file), và `RagService` (truy xuất + sinh câu trả). Mỗi service có một trách nhiệm duy nhất.

2. **Fallback graceful khi ChromaDB offline:** Vector store có thể chưa sẵn sàng khi server start, nhưng ứng dụng vẫn hoạt động. Chatbot trả lời fallback message thay vì crash.

3. **Deduplication tài liệu:** Trước khi ingest, kiểm tra `source` metadata để tránh lưu trùng khi server restart.

4. **Retry logic có backoff:** Hàm `withRetry()` thử lại 3 lần với delay tăng dần, phù hợp cho môi trường network không ổn định.

5. **Chunk overlap giữ context:** `chunkOverlap=200` đảm bảo ngữ cảnh không bị cắt đứt giữa câu.

6. **Rate limiting cho endpoint `/rag/ask`:** 15 request/phút/IP, tránh abuse.

7. **Source citation:** Trả về `fileName` và `page` từ metadata, cho phép user kiểm chứng nguồn.

8. **Lịch sử hội thoại:** Intent analyzer nhận context từ 10 tin nhắn gần nhất, giúp phân loại chính xác hơn.

---

## 8. Điểm Yếu & Cần Cải Thiện

### 8.1. Thiếu pagination cho conversation history
Lịch sử hội thoại chỉ lấy `take: 10`, không có offset. Với người dùng chat nhiều, context sẽ bị cắt.

**Cải thiện:** Thêm pagination (`page`, `limit`) hoặc sliding window (chỉ giữ N tin nhắn gần nhất có intent quan trọng).

### 8.2. Không có cache cho retrieval results
Mỗi lần hỏi đều phải embed lại câu hỏi và tìm kiếm vector. Các câu hỏi trùng lặp vẫn tốn chi phí API.

**Cải thiện:** Thêm Redis/in-memory cache cho query embeddings với TTL.

### 8.3. Không có re-ranking sau retrieval
Sau khi ChromaDB trả top-6 chunks, không có bước re-ranking (ví dụ: Cross-encoder) để sắp xếp lại theo relevance thực sự.

**Cải thiện:** Thêm bước Cross-encoder re-ranking trước khi đưa vào prompt.

### 8.4. Prompt RAG hardcoded trong code
Prompt cho RAG nằm trong `rag.service.ts`. Không có cơ chế để admin chỉnh sửa prompt mà không cần deploy lại.

**Cải thiện:** Lưu prompt vào database/config, có endpoint để update.

### 8.5. Không có chunk deletion hoặc update
Chỉ có `resetAndIngest()` xóa toàn bộ collection. Không có API để xóa hoặc update một file cụ thể.

**Cải thiện:** Thêm `DELETE /rag/doc/:fileName` và `PATCH /rag/doc/:fileName`.

### 8.6. Không có evaluation cho RAG quality
Không có cơ chế đo lường độ chính xác của câu trả lời RAG (precision, recall, hallucination rate).

**Cải thiện:** Thêm RAG evaluation pipeline (sử dụng RAGAS hoặc tự đánh giá).

### 8.7. ChromaDB là single point of failure
ChromaDB chạy standalone, không có replication. Dữ liệu vector mất = toàn bộ RAG không hoạt động.

**Cải thiện:** Chuyển sang Chroma cluster mode hoặc dùng PgVector (đã có trong config `postgresConnectionString`).

### 8.8. Temperature = 0.2 cho RAG (không phải 0)
Vẫn có xác suất hallucination nhỏ. Điểm chuẩn cho RAG là `temperature=0`.

**Cải thiện:** Đổi thành `temperature: 0` trong `rag.service.ts`.

### 8.9. Không có semantic chunking
Dùng `RecursiveCharacterTextSplitter` cắt theo ký tự cố định. Không thông minh, có thể cắt giữa đoạn logic.

**Cải thiện:** Thử `SemanticChunker` của LangChain hoặc custom splitter theo paragraph/section.

---

## 9. Bảng Tổng Hợp Endpoints RAG

| Method | Endpoint | Auth | Rate Limit | Mô tả |
|---|---|---|---|---|
| POST | `/rag/ingest` | Yes | Global | Ingest raw text |
| POST | `/rag/ask` | Yes | 15/60s | Hỏi đáp tài liệu |
| POST | `/rag/upload-doc` | No (`@Public`) | Global | Upload PDF + ingest |
| POST | `/rag/ingest-docs` | No | Global | Re-index company-docs |
| POST | `/rag/reset-docs` | No | Global | Reset + re-index |
| GET | `/rag/stats` | No | Global | Thống kê chunks |

---

## 10. Frontend Chatbot Widget

**Đường dẫn:** `ctu_infinity_client/src/stores/chatbotStore.ts`

**Component:** `ChatbotWidget` (rendered trong `RootLayout`)

Cấu trúc UI: Button toggle → MessageBubble list → Input + Send

Luồng dữ liệu: Zustand store → `chatbotService.chat()` → API → Update messages + isLoading

**Lưu ý:** Service `chatbotService` gọi `privateAxios.post('/chatbot/chat', payload)` — đây là endpoint của `ChatbotController`, khác với `RagController`.

---

## 11. Phụ Lục: Kiến Trúc Đa Intent Tổng Thể

```
/chatbot/chat (POST)
        │
        ▼
┌─────────────────────────────────────────────────┐
│  ChatbotService.handleChat()                     │
│                                                 │
│  analyzeIntent() ─→ 8 loại intent               │
│                                                 │
│  ask_my_info        ─→ DB: Student, Class       │
│  ask_my_scores      ─→ DB: StudentScore (tổng hợp)│
│  ask_my_events      ─→ DB: EventRegistration     │
│  ask_system_events  ─→ DB: Event (phân trang)    │
│  ask_suggested_events ─→ Gọi Recommendation_api │
│  ask_documents      ─→ RAG: ChromaDB + OpenAI     │
│  thanks_you        ─→ LLM trực tiếp              │
│  unknown           ─→ Fallback message           │
│                                                 │
│  buildAnswer() ─→ LLM format response + eventLinks│
└─────────────────────────────────────────────────┘
```
