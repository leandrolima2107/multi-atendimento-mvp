import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./login.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        memberships: {
          include: { company: { include: { plan: true } } },
        },
      },
    });

    if (
      !user?.isActive ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException("Email ou senha inválidos.");
    }

    const availableMemberships = user.memberships.filter(
      (membership) =>
        membership.company.status === "ACTIVE" &&
        (membership.company.plan?.isActive ?? true),
    );

    if (
      user.platformRole !== "PLATFORM_ADMIN" &&
      availableMemberships.length === 0
    ) {
      throw new UnauthorizedException("Empresa indisponível para acesso.");
    }

    const activeMembership = availableMemberships[0];
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      companyId: activeMembership?.companyId,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        platformRole: user.platformRole,
      },
      activeCompany: activeMembership?.company ?? null,
      memberships: availableMemberships.map((membership) => ({
          companyId: membership.companyId,
          role: membership.role,
          company: membership.company,
        })),
    };
  }
}
