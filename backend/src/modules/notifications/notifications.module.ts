import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { NotificationsService } from './notifications.service.js';
import { EmailSender, SmtpEmailSender } from './email-sender.js';
import { NotificationJobsService } from './notification-jobs.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    NotificationJobsService,
    { provide: EmailSender, useClass: SmtpEmailSender },
  ],
  exports: [NotificationsService, NotificationsGateway, NotificationJobsService],
})
export class NotificationsModule {}
