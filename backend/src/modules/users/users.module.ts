import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { AssignmentsModule } from '../assignments/assignments.module.js';

@Module({
  imports: [AuthModule, AssignmentsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
