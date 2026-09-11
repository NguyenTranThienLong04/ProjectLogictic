import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { AppModule } from './app.module.js';
import { structuredLog } from './common/logging/structured-log.js';
import { ConfiguredSocketIoAdapter } from './common/realtime/configured-socket-io.adapter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('PORT');
  const frontendUrl = configService.getOrThrow<string>('FRONTEND_URL');
  const trustProxyHops = Number(configService.getOrThrow<string>('TRUST_PROXY_HOPS'));

  app.useLogger(new Logger());
  if (trustProxyHops > 0) {
    const express = app.getHttpAdapter().getInstance() as Express;
    express.set('trust proxy', trustProxyHops);
  }
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  });
  app.useWebSocketAdapter(new ConfiguredSocketIoAdapter(app, frontendUrl));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerEnabled = configService.getOrThrow<string>('SWAGGER_ENABLED') === 'true';
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Logistics API')
      .setDescription('Versioned API for the logistics operations platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableShutdownHooks();
  await app.listen(port);
  Logger.log(
    structuredLog('application.started', {
      port,
      environment: configService.getOrThrow<string>('NODE_ENV'),
      swaggerEnabled,
      trustProxyHops,
    }),
    'Bootstrap',
  );
}

void bootstrap().catch((error: unknown) => {
  Logger.error(
    structuredLog('application.startup.failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
    'Bootstrap',
  );
  process.exitCode = 1;
});
