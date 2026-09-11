import { ApiProperty } from '@nestjs/swagger';
import { UserResponse } from '../../users/user.response.js';

export class AuthResponse {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ example: 900 })
  expiresIn!: number;

  @ApiProperty({ type: UserResponse })
  user!: UserResponse;
}

export class MessageResponse {
  @ApiProperty()
  message!: string;
}
