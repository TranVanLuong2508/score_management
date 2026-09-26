import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { TransformInterceptor } from './cores/transform.interceptor';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { ApiConfigService, SharedModule } from './shared';
import { CheckDatabaseConnection } from './utils/databaseConnection';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  // Check database connection
  await CheckDatabaseConnection(app);

  const configService = app.select(SharedModule).get(ApiConfigService);

  const port = Number(process.env.PORT ?? configService.appConfig.port);

  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector));
  app.useGlobalInterceptors(new TransformInterceptor(reflector));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  //cookie config
  app.use(cookieParser());

  //cors config
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    credentials: true,
  });

  //version config
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: ['1', '2'],
  });

  await app.listen(port, '0.0.0.0');
  logger.warn(`Application is running on: http://localhost:${port || 3000}`);
}
bootstrap();
