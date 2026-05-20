import { SetMetadata } from '@nestjs/common';
import { CompanyRole, PlatformRole } from './auth.types';

export const ROLES_KEY = 'roles';
export type AppRole = PlatformRole | CompanyRole;
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
