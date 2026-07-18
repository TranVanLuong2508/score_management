import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatbotService } from './chatbot.service';
import { Event } from '../events/entities/event.entity';
import { EventRegistration } from '../event-registration/entities/event-registration.entity';
import { StudentScore } from '../student-score/entities/student-score.entity';
import { Student } from '../students/entities/student.entity';
import { Criteria } from '../criterias/entities/criteria.entity';
import { CriteriaFrame } from '../criteria-frame/entities/criteria-frame.entity';
import { Semester } from '../semesters/entities/semester.entity';
import { RecommendationService } from '../recommendation/recommendation.service';
import { RagService } from '../rag/rag.service';
import { ApiConfigService } from 'src/shared';
import { ConversationHistory } from './entities/conversation-history.entity';

// Mock OpenAI
const mockChatCompletionsCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCompletionsCreate } },
  }));
});

describe('ChatbotService', () => {
  let service: ChatbotService;

  const mockStudentRepo = { findOne: jest.fn() };
  const mockConversationRepo = { find: jest.fn(), save: jest.fn(), create: jest.fn((data) => data), delete: jest.fn() };
  const mockRagService = {
    ask: jest.fn().mockResolvedValue({
      answer: 'Theo quy chế điểm rèn luyện...',
      sources: [{ fileName: 'QuyChe.pdf', page: 1 }],
    }),
  };
  const mockApiConfigService = {
    openAiConfig: { apiKey: 'sk-test', chatModel: 'gpt-4o-mini' },
  };
  const mockRecommendationService = {
    getRecommendationsForStudent: jest.fn().mockResolvedValue({ recommendations: [], studentId: null }),
  };
  const mockCriteriaFrameRepo = { findOne: jest.fn() };
  const mockCriteriaRepo = { find: jest.fn() };
  const mockStudentScoreRepo = { find: jest.fn() };
  const mockEventRegistrationRepo = { find: jest.fn() };
  const mockEventRepo = { find: jest.fn(), findAndCount: jest.fn() };
  const mockSemesterRepo = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: getRepositoryToken(Event), useValue: mockEventRepo },
        { provide: getRepositoryToken(EventRegistration), useValue: mockEventRegistrationRepo },
        { provide: getRepositoryToken(StudentScore), useValue: mockStudentScoreRepo },
        { provide: getRepositoryToken(Student), useValue: mockStudentRepo },
        { provide: getRepositoryToken(Criteria), useValue: mockCriteriaRepo },
        { provide: getRepositoryToken(CriteriaFrame), useValue: mockCriteriaFrameRepo },
        { provide: getRepositoryToken(Semester), useValue: mockSemesterRepo },
        { provide: ApiConfigService, useValue: mockApiConfigService },
        { provide: RecommendationService, useValue: mockRecommendationService },
        { provide: RagService, useValue: mockRagService },
        { provide: getRepositoryToken(ConversationHistory), useValue: mockConversationRepo },
      ],
    }).compile();

    service = module.get<ChatbotService>(ChatbotService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleChat', () => {
    it('should return document answer with sources for ask_documents intent', async () => {
      mockStudentRepo.findOne.mockResolvedValue({ studentId: 'student-1', studentCode: 'B12345' });
      mockConversationRepo.find.mockResolvedValue([]);
      mockConversationRepo.save.mockResolvedValue([]);
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ intent: 'ask_documents' }) } }],
      });

      const result = await service.handleChat('user-1', 'quy định điểm rèn luyện là gì?');

      expect(result.sources).toBeDefined();
      expect(Array.isArray(result.sources)).toBe(true);
    });

    it('should return fallback for unknown intent', async () => {
      mockStudentRepo.findOne.mockResolvedValue({ studentId: 'student-1', studentCode: 'B12345' });
      mockConversationRepo.find.mockResolvedValue([]);
      mockConversationRepo.save.mockResolvedValue([]);
      mockChatCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ intent: 'unknown' }) } }],
      });

      const result = await service.handleChat('user-1', 'thời tiết hôm nay thế nào?');

      expect(result.answer).toContain('không nằm trong phạm vi');
      expect(result.data).toEqual([]);
    });

    it('should throw NotFoundException when student not found', async () => {
      mockStudentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.handleChat('invalid-user', 'cho tôi biết điểm rèn luyện'),
      ).rejects.toThrow('Không tìm thấy thông tin sinh viên');
    });
  });

  describe('clearHistory', () => {
    it('should delete conversation history for user', async () => {
      await service.clearHistory('user-1');
      expect(mockConversationRepo.delete).toHaveBeenCalledWith({ userId: 'user-1' });
    });
  });

  describe('getSystemEvents (pagination)', () => {
    it('should return paginated events', async () => {
      mockSemesterRepo.findOne.mockResolvedValue({ semesterId: 'sem-1' });
      mockEventRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getSystemEvents(2, 10);

      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
      expect(mockEventRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('should return empty when no current semester', async () => {
      mockSemesterRepo.findOne.mockResolvedValue(null);

      const result = await service.getSystemEvents(1, 20);

      expect(result.pagination.total).toBe(0);
    });
  });
});
