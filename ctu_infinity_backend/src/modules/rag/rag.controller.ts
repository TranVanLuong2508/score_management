import { Body, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { RagService } from './rag.service';
import { IngestionService } from './services/ingestion.service';
import { AskQuestionDto, IngestTextDto } from './dto/rag.dto';
import { Public } from 'src/decorators/customize';

@Controller('rag')
@UseGuards(ThrottlerGuard)
export class RagController {
  constructor(
    private readonly ragService: RagService,
    private readonly ingestionService: IngestionService,
  ) {}

  /** Ingest raw text vào vector store */
  @Post('ingest')
  async ingest(@Body() body: IngestTextDto) {
    return this.ingestionService.ingestText(body.text, body.metadata);
  }

  /**
   * Re-index toàn bộ file PDF trong thư mục company-docs/.
   * Gọi khi thêm file PDF mới mà không muốn restart server.
   */
  @Post('ingest-docs')
  @Public()
  async ingestDocs() {
    return this.ingestionService.ingestCompanyDocs();
  }

  /**
   * Upload file PDF trực tiếp từ client và lưu vào thư mục company-docs,
   * sau đó tự động ingest file đó vào ChromaDB.
   */
  @Post('upload-doc')
  @Public()
  @UseInterceptors(FileInterceptor('file'))
  async uploadDoc(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn một file.');
    }
    if (!file.originalname.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('Chỉ hỗ trợ định dạng file PDF.');
    }
    return this.ingestionService.ingestUploadedPdf(file);
  }

  /**
   * Xóa toàn bộ collection rồi ingest lại sạch.
   * Dùng khi cần reset data (ví dụ: fix metadata, tránh duplicate).
   */
  @Post('reset-docs')
  @Public()
  async resetDocs() {
    return this.ingestionService.resetAndIngest();
  }

  /**
   * Thống kê số lượng chunks đã ingest trong ChromaDB, chia theo từng file.
   */
  @Get('stats')
  @Public()
  async stats() {
    return this.ingestionService.getStats();
  }

  /** Trả lời câu hỏi dựa trên tài liệu đã ingest */
  @Post('ask')
  @Public()
  @Throttle({ rag: { ttl: 60_000, limit: 15 } })
  async ask(@Body() body: AskQuestionDto) {
    return this.ragService.ask(body.question);
  }
}
