import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser, JwtPayload } from "./auth.types";
import { requiredConfig } from "../config";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requiredConfig(config, "JWT_SECRET"),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          include: { company: { include: { plan: true } } },
        },
      },
    });

    if (!user?.isActive) {
      throw new UnauthorizedException("Usuário inválido.");
    }

    const membership = payload.companyId
      ? user.memberships.find((item) => item.companyId === payload.companyId)
      : user.memberships.find(
          (item) =>
            item.company.status === "ACTIVE" &&
            (item.company.plan?.isActive ?? true),
        );

    if (payload.companyId && !membership) {
      throw new ForbiddenException("Permissão insuficiente para esta empresa.");
    }

    if (membership?.company.status === "SUSPENDED") {
      throw new ForbiddenException("Empresa suspensa.");
    }

    if (membership?.company.plan && !membership.company.plan.isActive) {
      throw new ForbiddenException("Plano da empresa está inativo.");
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      companyId: membership?.companyId ?? null,
      companyRole: membership?.role ?? null,
    };
  }
}
