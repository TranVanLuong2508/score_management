import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { createRedisConnection } from './common/redis/redis.connection';

// Modules
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RolePermissionModule } from './modules/role_permission/role_permission.module';
import { MajorModule } from './modules/majors/major.module';
import { ClassModule } from './modules/classes/class.module';
import { StudentModule } from './modules/students/student.module';
import { OrganizerModule } from './modules/organizers/organizer.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { EventModule } from './modules/events/event.module';
import { ApiConfigService } from './shared';
import { EventCategoryModule } from './modules/event_category/event_category.module';
import { FalcultiesModule } from './modules/falculties/falculties.module';
import { AcademicYearModule } from './modules/academic_year/academic_year.module';
import { SemestersModule } from './modules/semesters/semesters.module';
import { CriteriasModule } from './modules/criterias/criterias.module';
import { FilesModule } from './modules/files/files.module';
import { ElasticsearchModule } from './modules/elasticsearch/elasticsearch.module';
import { CriteriaFrameModule } from './modules/criteria-frame/criteria-frame.module';
import { EventTemplateModule } from './modules/event-template/event-template.module';
import { EventRegistrationModule } from './modules/event-registration/event-registration.module';
import { EventAttendanceModule } from './modules/event-attendance/event-attendance.module';
import { StudentScoreModule } from './modules/student-score/student-score.module';
import { GoogleCalendarModule } from './modules/google-calendar/google-calendar.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { EmailModule } from './modules/email/email.module';
import { RagModule } from './modules/rag/rag.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [SharedModule],
      inject: [ApiConfigService],
      useFactory: (configService: ApiConfigService) => configService.postgresConfig,
    }),
    BullModule.forRoot({
      connection: createRedisConnection(),
    }),
    SharedModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    RolePermissionModule,
    MajorModule,
    ClassModule,
    StudentModule,
    OrganizerModule,
    NotificationModule,
    EventModule,
    EventCategoryModule,
    FalcultiesModule,
    AcademicYearModule,
    SemestersModule,
    CriteriasModule,
    FilesModule,
    ElasticsearchModule,
    CriteriaFrameModule,
    EventTemplateModule,
    EventRegistrationModule,
    EventAttendanceModule,
    StudentScoreModule,
    GoogleCalendarModule,
    SubscriptionsModule,
    RecommendationModule,
    ChatbotModule,
    EmailModule,
    RagModule,
  ],
})
export class AppModule {}
