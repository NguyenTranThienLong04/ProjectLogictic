import { Module } from '@nestjs/common';
import { CodController } from './cod.controller.js';
import { CodService } from './cod.service.js';
@Module({ controllers: [CodController], providers: [CodService] })
export class CodModule {}
