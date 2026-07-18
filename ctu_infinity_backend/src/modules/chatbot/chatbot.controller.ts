import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ResponseMessage, SkipCheckPermission, User } from 'src/decorators/customize';
import { ChatbotService } from './chatbot.service';
import { ChatDto } from './dto/chat.dto';

@Controller('chatbot')
@SkipCheckPermission()
@UseGuards(ThrottlerGuard)
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  /**
   * POST /api/v1/chatbot/chat
   * Yêu cầu JWT — userId được lấy từ token để truy vấn đúng dữ liệu sinh viên.
   */
  @Post('chat')
  @ResponseMessage('Chat with chatbot')
  @Throttle({ chatbot: { ttl: 60_000, limit: 10 } })
  chat(@User('userId') userId: string, @Body() dto: ChatDto) {
    return this.chatbotService.handleChat(userId, dto.question, dto.page, dto.limit);
  }

  /**
   * DELETE /api/v1/chatbot/history
   * Xóa lịch sử hội thoại của user hiện tại.
   */
  @Delete('history')
  @ResponseMessage('Clear conversation history')
  clearHistory(@User('userId') userId: string) {
    return this.chatbotService.clearHistory(userId);
  }
}
