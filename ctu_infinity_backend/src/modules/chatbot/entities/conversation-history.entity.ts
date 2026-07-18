import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SenderRole {
  USER = 'user',
  BOT = 'bot',
}

@Entity('conversation_histories')
export class ConversationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text', nullable: true })
  answer: string;

  @Column({ name: 'intent', nullable: true })
  intent: string;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, any>;

  @Column({ name: 'sender_role', type: 'enum', enum: SenderRole, default: SenderRole.USER })
  senderRole: SenderRole;

  @Column({ name: 'sources', type: 'jsonb', nullable: true })
  sources: Array<{ fileName: string; page?: number }>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
