import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from './auth.types';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user?.companyId) {
      throw new ForbiddenException('Selecione uma empresa para acessar este recurso.');
    }
    return true;
  }
}
