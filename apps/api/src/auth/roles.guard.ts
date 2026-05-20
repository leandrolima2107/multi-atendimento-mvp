import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY, AppRole } from "./roles.decorator";
import { AuthUser } from "./auth.types";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user as
      | AuthUser
      | undefined;
    if (!user) {
      throw new ForbiddenException("Usuário não autenticado.");
    }

    const hasRole =
      required.includes(user.platformRole) ||
      (user.companyRole && required.includes(user.companyRole));
    if (!hasRole) {
      throw new ForbiddenException("Permissão insuficiente.");
    }

    return true;
  }
}
