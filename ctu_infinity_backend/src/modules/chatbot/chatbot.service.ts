import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import OpenAI from 'openai';
import { In, IsNull, Repository } from 'typeorm';
import { Event, EVENT_STATUS } from '../events/entities/event.entity';
import {
  EventRegistration,
  REGISTRATION_STATUS,
} from '../event-registration/entities/event-registration.entity';
import { StudentScore } from '../student-score/entities/student-score.entity';
import { Student } from '../students/entities/student.entity';
import { Criteria } from '../criterias/entities/criteria.entity';
import { CriteriaFrame } from '../criteria-frame/entities/criteria-frame.entity';
import { FrameworkStatus } from 'src/common/enums/framework-status.enum';
import { RecommendationService } from '../recommendation/recommendation.service';
import _ from 'lodash';
import { Semester } from '../semesters/entities/semester.entity';
import { RagService } from '../rag/rag.service';
import { ApiConfigService } from 'src/shared';
import { ConversationHistory, SenderRole } from './entities/conversation-history.entity';

type ChatIntent =
  | 'ask_my_info'
  | 'ask_my_scores'
  | 'ask_my_events'
  | 'ask_system_events'
  | 'ask_suggested_events'
  | 'ask_documents'
  | 'thanks_you'
  | 'unknown';

type IntentAnalysis = {
  intent: ChatIntent;
  keyword?: string;
  criteriaCode?: string;
  categoryName?: string;
};

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly openai: OpenAI;
  private readonly MAX_HISTORY = 10;

  constructor(
    private readonly apiConfig: ApiConfigService,
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    @InjectRepository(EventRegistration)
    private readonly eventRegistrationRepository: Repository<EventRegistration>,
    @InjectRepository(StudentScore)
    private readonly studentScoreRepository: Repository<StudentScore>,
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @InjectRepository(Criteria)
    private readonly criteriaRepository: Repository<Criteria>,
    @InjectRepository(CriteriaFrame)
    private readonly criteriaFrameRepository: Repository<CriteriaFrame>,
    @InjectRepository(Semester)
    private readonly semesterRepository: Repository<Semester>,
    private readonly recommendationService: RecommendationService,
    private readonly ragService: RagService,
    @InjectRepository(ConversationHistory)
    private readonly conversationRepo: Repository<ConversationHistory>,
  ) {
    this.openai = new OpenAI({
      apiKey: this.apiConfig.openAiConfig.apiKey,
    });
  }

  // ─── PUBLIC ENTRY POINT ────────────────────────────────────────────────────

  async handleChat(userId: string, question: string, page: number = 1, limit: number = 20) {
    const start = Date.now();
    const student = await this.findStudentByUserId(userId);

    const history = await this.conversationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: this.MAX_HISTORY,
    });

    const intent = await this.analyzeIntent(question, history);
    this.logger.debug(`[intent=${intent.intent}] userId=${userId}, question="${question.substring(0, 50)}..."`);

    let answer: { answer: string; data: unknown; eventLinks: unknown[]; sources?: unknown[] };

    switch (intent.intent) {
      case 'thanks_you':
        answer = await this.handleThanksYou();
        break;

      case 'ask_my_info': {
        const data = await this.getStudentProfile(student.studentId);
        this.logger.debug(`[ask_my_info] userId=${student.studentId}, resultCount=${Array.isArray(data) ? data.length : 0}`);
        answer = await this.buildAnswer(question, intent.intent, data);
        break;
      }

      case 'ask_my_scores': {
        const data = await this.getStudentScores(student.studentId);
        this.logger.debug(`[ask_my_scores] userId=${student.studentId}, duration=${Date.now() - start}ms`);
        answer = await this.buildAnswer(question, intent.intent, data);
        break;
      }

      case 'ask_my_events': {
        const data = await this.getStudentRegisteredEvents(student.studentId);
        this.logger.debug(`[ask_my_events] userId=${student.studentId}, resultCount=${Array.isArray(data) ? data.length : 0}`);
        answer = await this.buildAnswer(question, intent.intent, data);
        break;
      }

      case 'ask_system_events': {
        const data = await this.getSystemEvents(page, limit);
        this.logger.debug(`[ask_system_events] userId=${userId}, page=${page}, duration=${Date.now() - start}ms`);
        answer = await this.buildAnswer(question, intent.intent, data);
        break;
      }

      case 'ask_suggested_events': {
        const data = await this.getSuggestedEvents(userId);
        this.logger.debug(`[ask_suggested_events] userId=${userId}, duration=${Date.now() - start}ms`);
        answer = await this.buildAnswer(question, intent.intent, data);
        break;
      }

      case 'ask_documents': {
        const data = await this.getDocumentAnswer(question);
        this.logger.debug(`[ask_documents] userId=${userId}, sourcesCount=${data.sources.length}, duration=${Date.now() - start}ms`);
        answer = this.buildDocumentAnswer(question, data);
        break;
      }

      case 'unknown':
      default:
        answer = this.handleUnknownQuestion(question);
        break;
    }

    // ─── Lưu vào history ───
    await this.conversationRepo.save([
      this.conversationRepo.create({
        userId,
        question,
        senderRole: SenderRole.USER,
        intent: intent.intent,
      }),
      this.conversationRepo.create({
        userId,
        answer: answer.answer,
        senderRole: SenderRole.BOT,
        intent: intent.intent,
        data: answer as any,
        sources: (answer.sources as Array<{ fileName: string; page?: number }>) ?? [],
      }),
    ]);

    return answer;
  }

  async clearHistory(userId: string) {
    await this.conversationRepo.delete({ userId });
    this.logger.debug(`[clearHistory] userId=${userId}`);
  }

  // ─── INTENT ANALYSIS ─────────────────────────────────────────────────────

  private async analyzeIntent(question: string, history: ConversationHistory[]): Promise<IntentAnalysis> {
    const historyContext =
      history.length > 0
        ? `Lịch sử hội thoại gần đây:\n${[...history].reverse().map(h => `User: ${h.question}\nBot: ${h.answer ?? ''}`).join('\n')}\n\n`
        : '';

    const prompt = `
${historyContext}Phân tích câu hỏi của sinh viên trong hệ thống quản lý điểm rèn luyện CTU và xác định ý định:
"${question}"

Trả về JSON:
{
  "intent": "ask_my_info|ask_my_scores|ask_my_events|ask_system_events|ask_suggested_events|ask_documents|thanks_you|unknown",
  "keyword": "từ khóa tìm kiếm sự kiện nếu có",
  "criteriaCode": "mã tiêu chí nếu có (ví dụ: I, II, III, IV, V)",
  "categoryName": "tên danh mục sự kiện nếu có"
}

Hướng dẫn chọn intent:
- "ask_my_info": hỏi về thông tin cá nhân bản thân (tên, mã SV, lớp, khoa, năm học...)
- "ask_my_scores": hỏi về điểm rèn luyện của bản thân (tổng điểm, điểm từng tiêu chí, còn thiếu bao nhiêu...) lưu ý tổng điểm trên thang đánh giá là 100 tối đa
- "ask_my_events": hỏi về các sự kiện đã / đang đăng ký của bản thân (lịch sử tham gia, trạng thái đăng ký...)
- "ask_system_events": hỏi về sự kiện trên hệ thống (tìm kiếm sự kiện, sự kiện sắp diễn ra, chi tiết sự kiện X...)
- "ask_suggested_events": hỏi về gợi ý sự kiện phù hợp với bản thân (nên tham gia gì, sự kiện phù hợp với tiêu chí còn thiếu...)
- "ask_documents": hỏi về QUY ĐỊNH, CHÍNH SÁCH, QUY CHẾ, thông tin trong tài liệu (ví dụ: quy định điểm rèn luyện, cách xếp loại, tiêu chí đánh giá, quy chế học vụ...)
- "thanks_you": câu cảm ơn, chào hỏi kết thúc
- "unknown": câu hỏi KHÔNG liên quan đến hệ thống quản lý điểm rèn luyện CTU (ví dụ: thời tiết, tin tức, câu hỏi cá nhân không liên quan)

CHỈ trả về JSON, không markdown, không giải thích.
`;

    const completion = await this.openai.chat.completions.create({
      model: this.apiConfig.openAiConfig.chatModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content ?? '{}';
    return JSON.parse(raw) as IntentAnalysis;
  }

  // ─── RAG / DOCUMENT ANSWER ────────────────────────────────────────────────

  private async getDocumentAnswer(
    question: string,
  ): Promise<{ answer: string; sources: Array<{ fileName: string; page?: number }> }> {
    try {
      const result = await this.ragService.ask(question);
      return {
        answer: result.answer,
        sources: result.sources ?? [],
      };
    } catch (error) {
      this.logger.error(`[RAG] query failed: ${error.message}, question="${question.substring(0, 50)}..."`);
      return {
        answer: 'Xin lỗi, tôi không thể truy xuất tài liệu lúc này. Bạn có thể hỏi lại sau.',
        sources: [],
      };
    }
  }

  private buildDocumentAnswer(
    question: string,
    data: { answer: string; sources: Array<{ fileName: string; page?: number }> },
  ) {
    return {
      answer: data.answer,
      data: [],
      eventLinks: [],
      sources: data.sources,
    };
  }

  // ─── UNKNOWN INTENT ────────────────────────────────────────────────────────

  private handleUnknownQuestion(question: string) {
    this.logger.warn(`[Intent=unknown] question="${question.substring(0, 50)}..."`);
    return {
      answer:
        'Xin lỗi, câu hỏi của bạn không nằm trong phạm vi tôi có thể hỗ trợ.\n\n' +
        'Tôi có thể giúp bạn:\n' +
        '• Xem thông tin cá nhân (tên, mã SV, lớp)\n' +
        '• Xem điểm rèn luyện và tiêu chí\n' +
        '• Tìm sự kiện đã đăng ký / sự kiện trên hệ thống\n' +
        '• Gợi ý sự kiện phù hợp\n' +
        '• Tra cứu quy định, chính sách điểm rèn luyện\n\n' +
        'Bạn có thể hỏi lại theo một trong các chủ đề trên nhé!',
      data: [],
      eventLinks: [],
    };
  }

  // ─── BUILD ANSWER ─────────────────────────────────────────────────────────

  private async buildAnswer(question: string, intent: ChatIntent, data: unknown) {
    const isEmpty =
      data == null ||
      (Array.isArray(data) && data.length === 0) ||
      (typeof data === 'object' && !Array.isArray(data) && Object.keys(data as object).length === 0);

    if (isEmpty) {
      return {
        answer:
          'Xin lỗi, tôi không tìm thấy thông tin phù hợp trong hệ thống. Bạn có thể thử hỏi theo cách khác hoặc liên hệ Văn phòng Đoàn để được hỗ trợ.',
        data: Array.isArray(data) ? [] : data,
        eventLinks: [],
        sources: [],
      };
    }

    const prompt = `
Bạn là trợ lý AI của hệ thống quản lý điểm rèn luyện CTU Infinity, tên là InfinityBot.
Sinh viên hỏi: "${question}"

Dữ liệu từ hệ thống:
${JSON.stringify(data, null, 2)}

QUY TẮC BẮT BUỘC:
- CHỈ dùng thông tin từ dữ liệu trên, KHÔNG bịa đặt
- Nếu thiếu thông tin, nói rõ "Không có trong hệ thống"
- KHÔNG dùng markdown hay ký tự đặc biệt (**, ##, ...)
- Trả lời ngắn gọn, thân thiện, tiếng Việt tự nhiên
- Tối đa 300 từ

Trả về JSON:
{
  "answer": "Câu trả lời bằng tiếng Việt tự nhiên",
  "data": <giữ nguyên đúng cấu trúc dữ liệu đầu vào>,
  "eventLinks": [
    {
      "eventId": "uuid",
      "eventName": "tên sự kiện",
      "eventUrl": "url chi tiết sự kiện"
    }
  ]
}

QUY TẮC CHO eventLinks:
- Chỉ thêm những sự kiện BẠN ĐỀ CẬP / GỢI Ý TRONG answer (đúng trọng tâm câu hỏi)
- KHÔNG lấy tất cả sự kiện trong data
- Nếu không có sự kiện phù hợp để gắn link thì trả [].

CHỈ trả JSON, không markdown.
`;

    const completion = await this.openai.chat.completions.create({
      model: this.apiConfig.openAiConfig.chatModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const raw =
      completion.choices[0].message.content ??
      '{"answer":"Đã xảy ra lỗi xử lý.","data":[],"eventLinks":[]}';
    const parsed = JSON.parse(raw) as {
      answer?: string;
      data?: unknown;
      eventLinks?: Array<{ eventId?: string; eventName?: string; eventUrl?: string }>;
    };

    return {
      answer: parsed.answer ?? 'Đã xảy ra lỗi xử lý.',
      data: parsed.data ?? data,
      eventLinks: Array.isArray(parsed.eventLinks) ? parsed.eventLinks : [],
    };
  }

  private buildDataShape(intent: ChatIntent): string {
    switch (intent) {
      case 'ask_my_info':
        return '[{ studentCode, fullName, className, enrollmentYear, email }]';
      case 'ask_my_scores':
        return '[{ criteriaCode, criteriaName, totalScore, maxScore, eventCount, deficit }]';
      case 'ask_my_events':
        return '[{ eventName, registrationStatus, registeredAt, attendedAt, startDate, endDate, criteriaName, score }]';
      case 'ask_system_events':
        return '[{ eventId, eventName, location, startDate, endDate, registrationDeadline, score, criteriaName, organizerName }]';
      case 'ask_suggested_events':
        return '[{ eventId, eventName, location, startDate, registrationDeadline, score, criteriaCode, criteriaName, deficit }]';
      default:
        return '[]';
    }
  }

  // ─── INTENT: thanks_you ───────────────────────────────────────────────────

  private async handleThanksYou() {
    const completion = await this.openai.chat.completions.create({
      model: this.apiConfig.openAiConfig.chatModel,
      messages: [
        {
          role: 'user',
          content:
            'Bạn tên là InfinityBot, trợ lý của CTU Infinity. Sinh viên vừa nói cảm ơn. Hãy trả lời ngắn, thân thiện, vui vẻ bằng tiếng Việt. CHỈ TRẢ VỀ 1 DÒNG TEXT, KHÔNG JSON, KHÔNG MARKDOWN.',
        },
      ],
      temperature: 0.7,
    });

    return {
      answer: completion.choices[0].message.content?.trim() ?? 'Không có gì! Bạn cứ hỏi thêm nhé.',
      data: [] as unknown[],
      eventLinks: [] as unknown[],
      sources: [] as unknown[],
    };
  }

  // ─── DATA METHODS ─────────────────────────────────────────────────────────

  /**
   * INTENT: ask_my_info
   * Lấy thông tin hồ sơ sinh viên.
   */
  async getStudentProfile(studentId: string) {
    const student = await this.studentRepository.findOne({
      where: { studentId },
      relations: ['user', 'class'],
    });

    if (!student) return [];

    return [
      {
        studentCode: student.studentCode,
        fullName: student.user?.fullName ?? null,
        email: student.user?.email ?? null,
        avatarUrl: student.user?.avatarUrl ?? null,
        className: student.class?.className ?? null,
        enrollmentYear: student.enrollmentYear,
      },
    ];
  }

  /**
   * INTENT: ask_my_scores
   * Tổng hợp điểm rèn luyện của sinh viên theo từng tiêu chí.
   */
  async getStudentScores(studentId: string) {
    const activeFrame = await this.criteriaFrameRepository.findOne({
      where: { isActive: true, status: FrameworkStatus.ACTIVE },
      select: ['frameworkId'],
    });

    if (!activeFrame) return [];

    const [criterias, scoreRecords] = await Promise.all([
      this.criteriaRepository.find({
        where: { parentId: IsNull(), frameworkId: activeFrame.frameworkId },
        order: { displayOrder: 'ASC' },
      }),
      this.studentScoreRepository.find({ where: { studentId } }),
    ]);

    const scoreMap = scoreRecords.reduce<Map<string, { total: number; count: number }>>(
      (acc, record) => {
        const entry = acc.get(record.criteriaId) ?? { total: 0, count: 0 };
        entry.total += record.scoreValue;
        entry.count += 1;
        acc.set(record.criteriaId, entry);
        return acc;
      },
      new Map(),
    );

    return criterias.map((criteria) => {
      const entry = scoreMap.get(criteria.criteriaId) ?? { total: 0, count: 0 };
      return {
        criteriaCode: criteria.criteriaCode,
        criteriaName: criteria.criteriaName,
        totalScore: entry.total,
        maxScore: criteria.maxScore,
        eventCount: entry.count,
        deficit: criteria.maxScore != null ? Math.max(criteria.maxScore - entry.total, 0) : null,
      };
    });
  }

  /**
   * INTENT: ask_my_events
   * Danh sách sự kiện đã đăng ký của sinh viên (10 gần nhất).
   */
  async getStudentRegisteredEvents(studentId: string) {
    const registrations = await this.eventRegistrationRepository.find({
      where: { studentId },
      relations: ['event', 'event.organizer', 'event.criteria'],
      order: { registeredAt: 'DESC' },
      take: 10,
    });

    return registrations.map((reg) => ({
      eventId: reg.eventId ?? null,
      eventName: reg.event?.eventName ?? null,
      eventUrl: this.buildEventUrl(reg.eventId),
      registrationStatus: reg.status,
      registeredAt: reg.registeredAt,
      attendedAt: reg.attendedAt,
      startDate: reg.event?.startDate ?? null,
      endDate: reg.event?.endDate ?? null,
      location: reg.event?.location ?? null,
      criteriaName: reg.event?.criteria?.criteriaName ?? null,
      score: reg.event?.score ?? null,
    }));
  }

  /**
   * INTENT: ask_system_events
   * Tìm kiếm sự kiện đã duyệt theo / tiêu chí / danh mục.
   * Hỗ trợ pagination.
   */
  async getSystemEvents(page: number = 1, limit: number = 20) {
    const currentSemester = await this.semesterRepository.findOne({
      where: { isCurrent: true },
      select: ['semesterId'],
    });

    if (!currentSemester) return { events: { byCategoryName: [], byCriteriaName: [] }, pagination: { total: 0, page, limit, totalPages: 0 } };

    const [events, total] = await this.eventRepository.findAndCount({
      where: { status: EVENT_STATUS.APPROVED, semesterId: currentSemester.semesterId },
      relations: ['categories', 'organizer', 'criteria'],
      order: { startDate: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const eventItems = events.map((e) => ({
      eventId: e.eventId,
      eventName: e.eventName,
      description: e.description,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate,
      registrationDeadline: e.registrationDeadline,
      maxParticipants: e.maxParticipants,
      score: e.score,
      organizerName: e.organizer?.organizerName ?? null,
      criteriaCode: e.criteria?.criteriaCode ?? null,
      criteriaName: e.criteria?.criteriaName ?? null,
      categoryNames: (e.categories ?? [])
        .map((c) => c.categoryName)
        .filter(Boolean)
        .map((name) => String(name)),
    }));

    const byCategoryName = Object.entries(
      _.groupBy(
        eventItems.flatMap((ev) => {
          const names = ev.categoryNames.length ? ev.categoryNames : ['Chưa phân loại'];
          return names.map((categoryName) => ({
            categoryName,
            event: {
              ..._.omit(ev, ['categoryNames']),
              eventUrl: this.buildEventUrl(ev.eventId),
            },
          }));
        }),
        (x) => x.categoryName,
      ),
    ).map(([categoryName, items]) => ({
      categoryName,
      events: items.map((x) => x.event),
    }));

    const byCriteriaName = Object.entries(
      _.groupBy(
        eventItems.map((ev) => ({
          criteriaName: ev.criteriaName ?? 'Chưa có tiêu chí',
          criteriaCode: ev.criteriaCode ?? null,
          event: {
            ..._.omit(ev, ['categoryNames']),
            eventUrl: this.buildEventUrl(ev.eventId),
          },
        })),
        (x) => x.criteriaName,
      ),
    ).map(([criteriaName, items]) => ({
      criteriaName,
      criteriaCode: items[0]?.criteriaCode ?? null,
      events: items.map((x) => x.event),
    }));

    return {
      events: { byCategoryName, byCriteriaName },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * INTENT: ask_suggested_events
   * Gợi ý sự kiện phù hợp: ứng với tiêu chí sinh viên còn thiếu điểm,
   * còn hạn đăng ký, và sinh viên chưa tham gia.
   */
  async getSuggestedEvents(userId: string) {
    const hybrid = await this.recommendationService.getRecommendationsForStudent(userId, 'hybrid', {
      topK: 5,
    });

    const recommendations: Array<{
      eventId: string;
      eventName: string;
      location: string | null;
      startDate: Date | null;
      endDate: Date | null;
      registrationDeadline: Date | null;
      criteriaId: string | null;
      eventScore: number | null;
    }> = (hybrid as any)?.recommendations ?? [];

    if (!recommendations.length) return [];

    const recommendedStudentId: string | null = (hybrid as any)?.studentId ?? null;
    const criteriaIds = Array.from(
      new Set(recommendations.map((r) => r.criteriaId).filter(Boolean) as string[]),
    );

    const [scoreRecords, criterias] = await Promise.all([
      recommendedStudentId
        ? this.studentScoreRepository.find({ where: { studentId: recommendedStudentId } })
        : Promise.resolve([] as StudentScore[]),
      criteriaIds.length
        ? this.criteriaRepository.find({
            where: { criteriaId: In(criteriaIds) as any },
            select: {
              criteriaId: true,
              criteriaCode: true,
              criteriaName: true,
              maxScore: true,
            },
            order: { displayOrder: 'ASC' },
          })
        : Promise.resolve([] as Criteria[]),
    ]);

    const scoreMap = scoreRecords.reduce<Map<string, number>>((acc, r) => {
      acc.set(r.criteriaId, (acc.get(r.criteriaId) ?? 0) + r.scoreValue);
      return acc;
    }, new Map());

    const criteriaMap = new Map(criterias.map((c) => [c.criteriaId, c]));

    return recommendations.map((rec) => {
      const criteria = rec.criteriaId ? criteriaMap.get(rec.criteriaId) : undefined;
      const currentScore = rec.criteriaId ? (scoreMap.get(rec.criteriaId) ?? 0) : 0;
      const maxScore = criteria?.maxScore ?? null;
      const deficit = maxScore != null ? Math.max(maxScore - currentScore, 0) : null;

      return {
        eventId: rec.eventId,
        eventName: rec.eventName,
        eventUrl: this.buildEventUrl(rec.eventId),
        location: rec.location ?? null,
        startDate: rec.startDate ?? null,
        endDate: rec.endDate ?? null,
        registrationDeadline: rec.registrationDeadline ?? null,
        score: rec.eventScore ?? null,
        criteriaCode: criteria?.criteriaCode ?? null,
        criteriaName: criteria?.criteriaName ?? null,
        deficit,
      };
    });
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  private readonly FRONTEND_BASE_URL = 'http://localhost:3000';

  private buildEventUrl(eventId: string | null | undefined): string | null {
    if (!eventId) return null;
    return `${this.FRONTEND_BASE_URL.replace(/\/$/, '')}/events/${eventId}`;
  }

  private async findStudentByUserId(userId: string) {
    const student = await this.studentRepository.findOne({
      where: { userId },
      relations: ['user', 'class'],
    });

    if (!student) {
      throw new NotFoundException('Không tìm thấy thông tin sinh viên');
    }

    return student;
  }
}
