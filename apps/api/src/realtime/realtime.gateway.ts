import { JwtService } from "@nestjs/jwt";
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "../auth/auth.types";
import { Server, Socket } from "socket.io";
import { RealtimeService } from "./realtime.service";

type RealtimeSocketAuth = {
  userId: string;
};

type AuthenticatedSocket = Socket & {
  data: {
    auth?: RealtimeSocketAuth;
  };
};

@WebSocketGateway({ cors: { origin: "*", credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
  }

  async handleConnection(socket: AuthenticatedSocket) {
    const auth = await this.authenticate(socket);
    if (!auth) {
      socket.emit("auth:error", { message: "Autenticação necessária." });
      socket.disconnect(true);
      return;
    }

    socket.data.auth = auth;

    socket.on("company:join", async (companyId: string) => {
      if (!this.isNonEmptyString(companyId)) {
        socket.emit("company:error", { message: "Empresa inválida." });
        return;
      }

      const canJoin = await this.canJoinCompany(auth.userId, companyId);
      if (!canJoin) {
        socket.emit("company:error", {
          message: "Permissão insuficiente para esta empresa.",
        });
        return;
      }

      await socket.join(`company:${companyId}`);
    });
  }

  private async authenticate(
    socket: Socket,
  ): Promise<RealtimeSocketAuth | null> {
    const token = this.extractToken(socket);
    if (!token) {
      return null;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isActive: true },
      });

      if (!user?.isActive) {
        return null;
      }

      return { userId: user.id };
    } catch {
      return null;
    }
  }

  private extractToken(socket: Socket): string | null {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const authToken = auth?.token;
    if (typeof authToken === "string" && authToken.trim()) {
      return authToken.trim();
    }

    const authorization = socket.handshake.headers.authorization;
    const header = Array.isArray(authorization)
      ? authorization[0]
      : authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length).trim();
    }

    return null;
  }

  private async canJoinCompany(
    userId: string,
    companyId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.companyMember.findFirst({
      where: { userId, companyId },
      select: {
        id: true,
        company: {
          select: {
            status: true,
            plan: { select: { isActive: true } },
          },
        },
      },
    });

    return Boolean(
      membership &&
        membership.company.status === "ACTIVE" &&
        (membership.company.plan?.isActive ?? true),
    );
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }
}
