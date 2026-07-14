import { join } from 'node:path';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiConfigService {
  constructor(private readonly configService: ConfigService) {}

  private get(key: string): string {
    const value = this.configService.get<string>(key);

    if (value == null) {
      throw new Error(`${key} environment variable does not set`);
    }

    return value;
  }

  private getString(key: string): string {
    const value = this.get(key);

    return value.replaceAll(String.raw`\n`, '\n');
  }

  private getNumber(key: string): number {
    const value = this.get(key);

    try {
      return Number(value);
    } catch {
      throw new Error(`${key} environment variable is not a number`);
    }
  }

  private getBoolean(key: string): boolean {
    const value = this.get(key);

    try {
      return Boolean(JSON.parse(value));
    } catch {
      throw new Error(`${key} environment variable is not a boolean`);
    }
  }

  get nodeEnv(): string {
    return this.getString('NODE_ENV');
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get appConfig() {
    return {
      port: this.getString('APP_PORT'),
    };
  }

  get authConfig() {
    return {
      access_token_key: this.getString('ACCESS_TOKEN_SECRET'),
      refresh_token_key: this.getString('REFRESH_TOKEN_SECRET'),
      access_expiration_time: this.getString('ACCESS_TOKEN_expiresIn'),
      refresh_expiration_time: this.getString('REFRESH_TOKEN_expiresIn'),
    };
  }

  get postgresConfig(): TypeOrmModuleOptions {
    const entities = [join(__dirname, `../../modules/**/*.entity{.ts,.js}`)];

    return {
      entities,
      type: 'postgres',
      host: this.getString('DB_HOST'),
      port: this.getNumber('DB_PORT'),
      username: this.getString('DB_USERNAME'),
      password: this.getString('DB_PASSWORD'),
      database: this.getString('DB_DATABASE'),
      logging: this.getBoolean('ENABLE_ORM_LOGS'),
      synchronize: this.getBoolean('ENABLE_SYCHORIZE_DB'),
    };
  }

  get nodeMailerConfig() {
    return {
      appPass: this.getString('EMAIL_AUTH_PASS'),
      emailAuth: this.getString('EMAIL_AUTH_USER'),
      emailHost: this.getString('EMAIL_HOST'),
      preview: this.getBoolean('EMAIL_PREVIEW'),
    };
  }

  get googleCalendarConfig() {
    return {
      clientId: this.getString('GOOGLE_CLIENT_ID'),
      clientSecret: this.getString('GOOGLE_CLIENT_SECRET'),
      redirectUri: this.getString('GOOGLE_REDIRECT_URI'),
      refreshToken: this.getString('GOOGLE_REFRESH_TOKEN'),
    };
  }

  get sendgridConfig() {
    return {
      apiKey: this.getString('SENDGRID_API_KEY'),
      fromEmail: this.getString('SENDGRID_FROM_EMAIL'),
      fromName: this.getString('SENDGRID_FROM_NAME'),
    };
  }

  get chromaConfig() {
    return {
      chromaUrl: this.getString('CHROMA_HOST'),
    };
  }

  /** Connection string dùng cho PGVectorStore (RAG module) */
  get postgresConnectionString(): string {
    const host = this.getString('DB_HOST');
    const port = this.getNumber('DB_PORT');
    const username = this.getString('DB_USERNAME');
    const password = this.getString('DB_PASSWORD');
    const database = this.getString('DB_DATABASE');
    return `postgresql://${username}:${password}@${host}:${port}/${database}`;
  }

  get openAiConfig() {
    return {
      apiKey: this.getString('OPENAI_API_KEY'),
      chatModel: this.configService.get<string>('OPENAI_CHAT_MODEL') || 'gpt-4o-mini',
    };
  }
}
