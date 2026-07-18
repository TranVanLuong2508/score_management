import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { Event } from '../events/entities/event.entity';
import { EventRegistration } from '../event-registration/entities/event-registration.entity';
import { StudentScore } from '../student-score/entities/student-score.entity';
import { Student } from '../students/entities/student.entity';
import { Criteria } from '../criterias/entities/criteria.entity';
import { CriteriaFrame } from '../criteria-frame/entities/criteria-frame.entity';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { Semester } from '../semesters/entities/semester.entity';
import { RagModule } from '../rag/rag.module';
import { ConversationHistory } from './entities/conversation-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Event,
      EventRegistration,
      StudentScore,
      Student,
      Criteria,
      CriteriaFrame,
      Semester,
      ConversationHistory,
    ]),
    RecommendationModule,
    RagModule,
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService],
  exports: [ChatbotService],
})
export class ChatbotModule {}
