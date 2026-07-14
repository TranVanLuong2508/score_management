import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { VectorStoreService } from './vector-store.service';
import { Document } from '@langchain/core/documents';
import * as path from 'path';
import * as fs from 'fs';
import { ChromaClient } from 'chromadb';
import { ApiConfigService } from 'src/shared';

@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly logger = new Logger(IngestionService.name);

  /** Thư mục chứa tài liệu công ty (JD, quy định, ...) */
  private readonly COMPANY_DOCS_DIR = path.resolve(process.cwd(), 'src', 'modules', 'rag', 'company-docs');

  constructor(
    private readonly vectorStoreService: VectorStoreService,
    private readonly apiConfig: ApiConfigService,
  ) {}

  // ─── LIFECYCLE ────────────────────────────────────────────────────────────

  /**
   * Tự động ingest toàn bộ PDF trong company-docs/ khi module khởi động.
   * Chỉ chạy nếu thư mục tồn tại và có file PDF.
   */
  async onModuleInit() {
    await this.ingestCompanyDocs();
  }

  // ─── PUBLIC METHODS ───────────────────────────────────────────────────────

  /**
   * Ingest raw text (gọi qua API).
   */
  async ingestText(rawText: string, metadata: Record<string, any> = {}) {
    const chunks = await this.splitText([rawText], [metadata]);
    await this.vectorStoreService.vectorStore.addDocuments(chunks);
    return { chunksAdded: chunks.length };
  }

  /**
   * Ingest tất cả file PDF trong thư mục company-docs/.
   * Có thể gọi lại qua endpoint để re-index khi thêm file mới.
   */
  async ingestCompanyDocs(): Promise<{ filesProcessed: number; chunksAdded: number }> {
    if (!fs.existsSync(this.COMPANY_DOCS_DIR)) {
      this.logger.warn(`Thư mục company-docs không tồn tại: ${this.COMPANY_DOCS_DIR}`);
      return { filesProcessed: 0, chunksAdded: 0 };
    }

    const pdfFiles = fs
      .readdirSync(this.COMPANY_DOCS_DIR)
      .filter((f) => f.toLowerCase().endsWith('.pdf'));

    if (!pdfFiles.length) {
      this.logger.log('Không có file PDF nào trong company-docs/');
      return { filesProcessed: 0, chunksAdded: 0 };
    }

    let totalChunks = 0;
    let skippedFiles = 0;

    // Khởi tạo ChromaClient để kiểm tra deduplication
    const chromaUrl = new URL(this.apiConfig.chromaConfig.chromaUrl);
    const chromaClient = new ChromaClient({
      host: chromaUrl.hostname,
      port: chromaUrl.port ? parseInt(chromaUrl.port, 10) : (chromaUrl.protocol === 'https:' ? 443 : 80),
      ssl: chromaUrl.protocol === 'https:',
    });

    for (const fileName of pdfFiles) {
      const filePath = path.join(this.COMPANY_DOCS_DIR, fileName);
      try {
        // Kiểm tra xem file đã được ingest chưa (deduplication)
        const alreadyIngested = await this.isAlreadyIngested(chromaClient, fileName);
        if (alreadyIngested) {
          this.logger.log(`⏭ Bỏ qua "${fileName}" (đã tồn tại trong ChromaDB)`);
          skippedFiles++;
          continue;
        }

        const chunks = await this.loadPdf(filePath, { source: fileName });
        await this.vectorStoreService.vectorStore.addDocuments(chunks);
        totalChunks += chunks.length;
        this.logger.log(`✓ Ingest "${fileName}" → ${chunks.length} chunks`);
      } catch (err) {
        this.logger.error(`✗ Lỗi khi ingest "${fileName}": ${(err as Error).message}`);
      }
    }

    this.logger.log(`Hoàn tất: ${pdfFiles.length} file (${skippedFiles} bỏ qua, ${pdfFiles.length - skippedFiles} mới), ${totalChunks} chunks mới`);
    return { filesProcessed: pdfFiles.length - skippedFiles, chunksAdded: totalChunks };
  }

  /**
   * Xử lý file PDF upload: lưu vào máy và ingest vào ChromaDB.
   */
  async ingestUploadedPdf(file: any): Promise<{ fileName: string; chunksAdded: number; message: string }> {
    if (!fs.existsSync(this.COMPANY_DOCS_DIR)) {
      fs.mkdirSync(this.COMPANY_DOCS_DIR, { recursive: true });
    }

    const fileName = file.originalname;
    const filePath = path.join(this.COMPANY_DOCS_DIR, fileName);

    // 1. Lưu file vào ổ cứng
    fs.writeFileSync(filePath, file.buffer);
    this.logger.log(`📥 Đã lưu file upload tới: ${filePath}`);

    // 2. Ingest file này vào ChromaDB
    const chromaUrl = new URL(this.apiConfig.chromaConfig.chromaUrl);
    const chromaClient = new ChromaClient({
      host: chromaUrl.hostname,
      port: chromaUrl.port ? parseInt(chromaUrl.port, 10) : (chromaUrl.protocol === 'https:' ? 443 : 80),
      ssl: chromaUrl.protocol === 'https:',
    });

    const alreadyIngested = await this.isAlreadyIngested(chromaClient, fileName);
    if (alreadyIngested) {
      this.logger.log(`⏭ Bỏ qua "${fileName}" (đã tồn tại trong ChromaDB)`);
      return { fileName, chunksAdded: 0, message: 'File đã tồn tại trong hệ thống, không cần ingest lại.' };
    }

    try {
      const chunks = await this.loadPdf(filePath, { source: fileName });
      await this.vectorStoreService.vectorStore.addDocuments(chunks);
      this.logger.log(`✓ Ingest "${fileName}" → ${chunks.length} chunks`);
      return { fileName, chunksAdded: chunks.length, message: 'Upload và ingest thành công!' };
    } catch (err) {
      this.logger.error(`✗ Lỗi khi ingest "${fileName}": ${(err as Error).message}`);
      throw new Error(`Lỗi khi xử lý file: ${(err as Error).message}`);
    }
  }

  /**
   * Xóa toàn bộ collection rồi ingest lại sạch.
   * Dùng khi cần reset (tránh duplicate, fix metadata...).
   */
  async resetAndIngest(): Promise<{ deleted: boolean; filesProcessed: number; chunksAdded: number }> {
    const chromaUrl = new URL(this.apiConfig.chromaConfig.chromaUrl);
    const chromaClient = new ChromaClient({
      host: chromaUrl.hostname,
      port: chromaUrl.port ? parseInt(chromaUrl.port, 10) : (chromaUrl.protocol === 'https:' ? 443 : 80),
      ssl: chromaUrl.protocol === 'https:',
    });

    try {
      await chromaClient.deleteCollection({ name: 'company_documents' });
      this.logger.log('🗑️ Đã xóa collection company_documents');
    } catch {
      this.logger.warn('Collection chưa tồn tại, bỏ qua bước xóa.');
    }

    const result = await this.ingestCompanyDocs();
    return { deleted: true, ...result };
  }

  /**
   * Thống kê số chunks đã ingest trong ChromaDB, chia theo từng file nguồn.
   */
  async getStats(): Promise<{ totalChunks: number; bySource: Record<string, number> }> {
    const chromaUrl = new URL(this.apiConfig.chromaConfig.chromaUrl);
    const chromaClient = new ChromaClient({
      host: chromaUrl.hostname,
      port: chromaUrl.port ? parseInt(chromaUrl.port, 10) : (chromaUrl.protocol === 'https:' ? 443 : 80),
      ssl: chromaUrl.protocol === 'https:',
    });

    try {
      const collection = await chromaClient.getCollection({ name: 'company_documents' });
      // Lấy tất cả records (chỉ metadata, không cần embedding)
      const all = await collection.get({ include: ['metadatas'] as any });
      const totalChunks = all.ids.length;

      // Đếm theo từng file nguồn
      const bySource: Record<string, number> = {};
      for (const meta of all.metadatas ?? []) {
        const src = (meta?.source as string) ?? 'unknown';
        bySource[src] = (bySource[src] ?? 0) + 1;
      }

      return { totalChunks, bySource };
    } catch {
      return { totalChunks: 0, bySource: {} };
    }
  }

  // ─── PRIVATE HELPERS ──────────────────────────────────────────────────────

  /**
   * Kiểm tra xem file PDF đã được ingest vào ChromaDB chưa.
   * Dùng metadata `source` để truy vấn. Tránh duplicate khi restart server.
   */
  private async isAlreadyIngested(chromaClient: ChromaClient, fileName: string): Promise<boolean> {
    try {
      const collection = await chromaClient.getCollection({ name: 'company_documents' });
      const result = await collection.get({ where: { source: fileName }, limit: 1 });
      return result.ids.length > 0;
    } catch {
      // Collection chưa tồn tại hoặc lỗi kết nối → coi như chưa ingest
      return false;
    }
  }

  private async loadPdf(filePath: string, metadata: Record<string, any> = {}): Promise<Document[]> {
    const loader = new PDFLoader(filePath, { splitPages: true });
    const rawDocs = await loader.load();

    // Gắn thêm metadata tùy chỉnh và làm sạch các field object lồng nhau để tránh lỗi cho Chroma DB
    // BUG FIX: dùng `fileName` (metadata.source) thay vì `filePath` để nhất quán với deduplication check
    const docsWithMeta = rawDocs.map((doc) => {
      const safeMetadata: Record<string, any> = { ...metadata }; // metadata.source = fileName
      
      // Chỉ giữ lại các kiểu dữ liệu cơ bản được Chroma chấp nhận
      for (const [key, value] of Object.entries(doc.metadata)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          safeMetadata[key] = value;
        } else if (key === 'loc' && value && (value as any).pageNumber) {
          safeMetadata.page = (value as any).pageNumber;
        }
      }

      return new Document({ pageContent: doc.pageContent, metadata: safeMetadata });
    });

    return this.splitText(
      docsWithMeta.map((d) => d.pageContent),
      docsWithMeta.map((d) => d.metadata),
    );
  }

  private async splitText(texts: string[], metadatas: Record<string, any>[]): Promise<Document[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      // Tăng chunkSize để giữ nhiều ngữ cảnh hơn (phù hợp với JD dài)
      chunkSize: 1500,
      chunkOverlap: 200,
    });
    return splitter.createDocuments(texts, metadatas);
  }
}
