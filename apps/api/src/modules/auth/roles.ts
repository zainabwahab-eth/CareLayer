// App audience <-> database role <-> API role.
import type { AppAudience, UserRole as ApiRole } from '@carelayer/shared';
import type { UserRole } from '../../generated/prisma/client.js';

export const ROLE_BY_APP: Record<AppAudience, UserRole> = {
  women: 'WOMAN',
  nurses: 'NURSE',
  admin: 'ADMIN',
};

export const API_ROLE: Record<UserRole, ApiRole> = {
  WOMAN: 'woman',
  NURSE: 'nurse',
  ADMIN: 'admin',
};

export const APP_BY_ROLE: Record<UserRole, AppAudience> = {
  WOMAN: 'women',
  NURSE: 'nurses',
  ADMIN: 'admin',
};
