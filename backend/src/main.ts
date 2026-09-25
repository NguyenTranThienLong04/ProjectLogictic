import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { structuredLog } from './common/logging/structured-log.js';
import { ConfiguredSocketIoAdapter } from './common/realtime/configured-socket-io.adapter.js';

let startupStage = 'environment/module loading';
console.log('Starting API...');
const startupDeadline = setTimeout(() => {
  console.error(`API startup timed out during ${startupStage} (60 seconds)`);
  process.exit(1);
}, 60_000);

async function bootstrap(): Promise<void> {
  // Import inside the guarded bootstrap so environment validation failures are caught.
  const { AppModule } = await import('./app.module.js');
  startupStage = 'Nest dependency construction';
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
    rawBody: true,
  });
  const configService = app.get(ConfigService);
  const port = Number(configService.getOrThrow<string>('PORT'));
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
  startupStage = 'DB/Redis/BullMQ initialization';
  await app.init();
  startupStage = 'HTTP listen';
  await app.listen(port, '0.0.0.0');
  clearTimeout(startupDeadline);
  console.log(`Listening on 0.0.0.0:${port}`);
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
  console.error(
    structuredLog('application.startup.failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      stage: startupStage,
    }),
  );
  clearTimeout(startupDeadline);
  // Existing Redis/BullMQ sockets must not keep a failed bootstrap alive.
  process.exit(1);
});
