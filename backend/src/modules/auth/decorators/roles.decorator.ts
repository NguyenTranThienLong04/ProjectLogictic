import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../../generated/prisma/client.js';
import { ROLES_KEY } from '../auth.constants.js';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
