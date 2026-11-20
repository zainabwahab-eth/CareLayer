import type { User as ApiUser } from '@carelayer/shared';
import type { User } from '../../generated/prisma/client.js';
import { API_ROLE } from '../auth/roles.js';

export function toUserDto(user: User): ApiUser {
  return {
    id: user.id,
    role: API_ROLE[user.role],
    displayName: user.displayName,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}
