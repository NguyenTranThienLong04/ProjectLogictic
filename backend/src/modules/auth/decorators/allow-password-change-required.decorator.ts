import { SetMetadata } from '@nestjs/common';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from '../auth.constants.js';

export const AllowPasswordChangeRequired = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, true);
