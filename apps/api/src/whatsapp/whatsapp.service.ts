import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, WhatsappInstance } from "@prisma/client";
import axios from "axios";
import crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { CreateWhatsappInstanceDto } from "./whatsapp.dto";

type SafeWhatsappInstance = Omit<
  WhatsappInstance,
  "apiKey" | "webhookSecret" | "providerInstanceId"
>;
type EvolutionCreateResult = {
  providerInstanceId?: string;
  token?: string;
};
type EvolutionRemoteInstance = {
  id?: string;
  name?: string;
  token?: string;
};
type EvolutionConnectResult = {
  qrCode?: string | null;
};
type EvolutionAuth = {
  baseUrl: string;
  authKey: string;
  providerInstanceId: string;
};

const EVOLUTION_WEBHOOK_EVENTS = [
  "MESSAGE",
  "SEND_MESSAGE",
  "CONNECTION",
  "QRCODE",
  "READ_RECEIPT",
];

const EVOLUTION_ADVANCED_SETTINGS = {
  alwaysOnline: false,
  ignoreGroups: true,
  ignoreStatus: true,
  msgRejectCall: "Atendimento por chamada não disponível neste canal.",
  readMessages: false,
  rejectCall: true,
};

@Injectable()
export class WhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  async list(companyId: string) {
    const instances = await this.prisma.whatsappInstance.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });

    return instances.map((instance) => this.sanitizeInstance(instance));
  }

  async create(companyId: string, dto: CreateWhatsappInstanceDto) {
    const { instance, apiKey } = await this.prisma.$transaction(
      async (tx) => {
        const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
          include: {
            plan: true,
            _count: { select: { whatsappInstances: true } },
          },
        });

        if (company.status === "SUSPENDED") {
          throw new BadRequestException("Empresa suspensa.");
        }

        if (!company.plan) {
          throw new BadRequestException(
            "Defina um plano para a empresa antes de criar números WhatsApp.",
          );
        }

        if (!company.plan.isActive) {
          throw new BadRequestException("Plano da empresa está inativo.");
        }

        const limit = company.plan.maxWhatsappInstances;
        if (company._count.whatsappInstances >= limit) {
          throw new BadRequestException(
            "Limite de números WhatsApp do plano atingido.",
          );
        }

        const instanceKey = `${company.slug}-${crypto.randomBytes(4).toString("hex")}`;
        const webhookSecret = crypto.randomBytes(24).toString("hex");
        const apiKey = crypto.randomBytes(24).toString("hex");
        const instance = await tx.whatsappInstance.create({
          data: {
            companyId,
            name: dto.name,
            phoneNumber: dto.phoneNumber,
            instanceKey,
            webhookSecret,
            apiKey,
            status: "CREATED",
          },
        });

        return { instance, apiKey };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const evolution = await this.tryCreateEvolutionInstance(
      instance.instanceKey,
      apiKey,
    );
    const updated = await this.prisma.whatsappInstance.update({
      where: { id: instance.id },
      data: {
        providerInstanceId: evolution?.providerInstanceId,
        apiKey: evolution?.token ?? apiKey,
        lastError: evolution
          ? null
          : "Instância criada localmente, mas a Evolution Go não confirmou a criação.",
      },
    });

    return this.sanitizeInstance(updated);
  }

  async connect(companyId: string, id: string) {
    const instance = await this.getOwned(companyId, id);
    if (instance.status === "CONNECTED") {
      await this.refreshEvolutionStatus(instance.id);
      const current = await this.getOwned(companyId, id);
      if (current.status === "CONNECTED") {
        return this.sanitizeInstance(current);
      }
    }

    await this.tryConnectEvolutionInstance(
      instance.id,
      instance.instanceKey,
      instance.providerInstanceId,
      instance.apiKey ?? undefined,
      instance.webhookSecret,
      instance.phoneNumber,
    );

    const updated = await this.getOwned(companyId, id);
    return this.sanitizeInstance(updated);
  }

  async requestQrCode(companyId: string, id: string) {
    const instance = await this.getOwned(companyId, id);
    const shouldLogout = instance.status === "CONNECTED";

    if (shouldLogout) {
      const loggedOut = await this.tryLogoutEvolutionInstance(instance);
      if (!loggedOut) {
        const updated = await this.prisma.whatsappInstance.update({
          where: { id },
          data: {
            status: "ERROR",
            qrCode: null,
            lastError:
              "Não foi possível desconectar a sessão atual para gerar um novo QR Code.",
          },
        });
        return this.sanitizeInstance(updated);
      }
    }

    const connection = await this.tryConnectEvolutionInstance(
      instance.id,
      instance.instanceKey,
      instance.providerInstanceId,
      instance.apiKey ?? undefined,
      instance.webhookSecret,
      instance.phoneNumber,
    );

    const updated = connection
      ? await this.getOwned(companyId, id)
      : await this.prisma.whatsappInstance.update({
          where: { id },
          data: {
            status: "ERROR",
            qrCode: null,
            lastError: "Não foi possível iniciar a geração do QR Code.",
          },
        });

    return this.sanitizeInstance(updated);
  }

  async refreshStatus(companyId: string, id: string) {
    const instance = await this.getOwned(companyId, id);
    await this.refreshEvolutionStatus(instance.id);
    const updated = await this.getOwned(companyId, id);
    return this.sanitizeInstance(updated);
  }

  async markConnection(
    instanceKey: string,
    status: "CONNECTED" | "DISCONNECTED" | "ERROR",
    qrCode?: string,
    error?: string,
  ) {
    return this.prisma.whatsappInstance.update({
      where: { instanceKey },
      data: { status, qrCode, lastError: error },
    });
  }

  async getOwned(companyId: string, id: string) {
    const instance = await this.prisma.whatsappInstance.findFirst({
      where: { id, companyId },
    });
    if (!instance) {
      throw new NotFoundException("Instância WhatsApp não encontrada.");
    }
    return instance;
  }

  private sanitizeInstance(instance: WhatsappInstance): SafeWhatsappInstance {
    const { apiKey, webhookSecret, providerInstanceId, ...safeInstance } =
      instance;
    void apiKey;
    void webhookSecret;
    void providerInstanceId;
    return safeInstance;
  }

  private async tryCreateEvolutionInstance(
    instanceKey: string,
    apiKey: string,
  ): Promise<EvolutionCreateResult | null> {
    const baseUrl = this.config.get<string>("EVOLUTION_BASE_URL");
    const globalApiKey = this.config.get<string>("EVOLUTION_GLOBAL_API_KEY");
    if (!baseUrl || !globalApiKey) {
      return null;
    }

    try {
      const response = await axios.post(
        `${baseUrl}/instance/create`,
        {
          name: instanceKey,
          token: apiKey,
        },
        { headers: { apikey: globalApiKey }, timeout: 10000 },
      );
      return this.parseCreateResult(response.data);
    } catch (error) {
      await this.prisma.whatsappInstance.update({
        where: { instanceKey },
        data: { status: "ERROR", lastError: this.errorMessage(error) },
      });
      return null;
    }
  }

  private async tryConnectEvolutionInstance(
    localId: string,
    instanceKey: string,
    providerInstanceId?: string | null,
    apiKey?: string | null,
    webhookSecret?: string | null,
    phoneNumber?: string | null,
  ): Promise<EvolutionConnectResult | null> {
    const auth = await this.ensureEvolutionInstance(
      localId,
      instanceKey,
      providerInstanceId,
      apiKey,
    );
    if (!auth) {
      await this.prisma.whatsappInstance.update({
        where: { id: localId },
        data: {
          status: "ERROR",
          qrCode: null,
          lastError: "Configuração incompleta da Evolution Go para esta instância.",
        },
      });
      return null;
    }

    try {
      return await this.connectEvolutionWithAuth(
        localId,
        instanceKey,
        auth,
        webhookSecret,
        phoneNumber,
      );
    } catch (error) {
      if (this.shouldRecreateEvolutionInstance(error)) {
        const recreatedAuth = await this.ensureEvolutionInstance(
          localId,
          instanceKey,
          providerInstanceId,
          apiKey,
          true,
        );

        if (recreatedAuth) {
          try {
            return await this.connectEvolutionWithAuth(
              localId,
              instanceKey,
              recreatedAuth,
              webhookSecret,
              phoneNumber,
            );
          } catch (retryError) {
            error = retryError;
          }
        }
      }

      await this.prisma.whatsappInstance.update({
        where: { id: localId },
        data: {
          status: "ERROR",
          qrCode: null,
          lastError: this.errorMessage(error),
        },
      });
      return null;
    }
  }

  private async connectEvolutionWithAuth(
    localId: string,
    instanceKey: string,
    auth: EvolutionAuth,
    webhookSecret?: string | null,
    phoneNumber?: string | null,
  ) {
    const webhookUrl = await this.webhookUrl(localId, webhookSecret);
    const reachabilityError = this.webhookReachabilityError(
      auth.baseUrl,
      webhookUrl,
    );
    if (reachabilityError) {
      throw new Error(reachabilityError);
    }

    await this.tryConfigureEvolutionAdvancedSettings(localId, auth);

    const connect = await axios.post(
      `${auth.baseUrl}/instance/connect`,
      {
        webhookUrl,
        subscribe: EVOLUTION_WEBHOOK_EVENTS,
        immediate: true,
        phone: phoneNumber || undefined,
      },
      {
        headers: {
          apikey: auth.authKey,
          instanceId: auth.providerInstanceId,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
    );
    const qrCode =
      this.extractQrCode(connect.data) ??
      (await this.fetchQrCodeWithRetry(auth, instanceKey));

    await this.prisma.whatsappInstance.update({
      where: { id: localId },
      data: {
        status: qrCode ? "QR_PENDING" : "CREATED",
        qrCode,
        lastError: qrCode
          ? null
          : "Conexão iniciada. Aguarde o QR Code chegar pelo webhook.",
      },
    });
    return { qrCode };
  }

  private async refreshEvolutionStatus(localId: string) {
    const instance = await this.prisma.whatsappInstance.findUnique({
      where: { id: localId },
    });
    const auth = this.evolutionAuth(
      instance?.providerInstanceId,
      instance?.apiKey,
    );
    if (!instance || !auth) {
      return false;
    }

    try {
      const response = await this.fetchStatus(auth, instance.instanceKey);
      const connected = this.isConnected(response.data);
      await this.prisma.whatsappInstance.update({
        where: { id: localId },
        data: {
          status: connected ? "CONNECTED" : "DISCONNECTED",
          qrCode: connected ? null : instance.qrCode,
          lastError: null,
        },
      });
      return true;
    } catch (error) {
      await this.prisma.whatsappInstance.update({
        where: { id: localId },
        data: { status: "ERROR", lastError: this.errorMessage(error) },
      });
      return false;
    }
  }

  private parseCreateResult(data: unknown): EvolutionCreateResult {
    const value = data as {
      data?: {
        id?: string;
        token?: string;
        instance?: { id?: string; token?: string };
      };
      id?: string;
      token?: string;
      instance?: { id?: string; token?: string };
    };

    return {
      providerInstanceId:
        value.data?.id ?? value.data?.instance?.id ?? value.id ?? value.instance?.id,
      token: value.data?.token ?? value.data?.instance?.token ?? value.token ?? value.instance?.token,
    };
  }

  private async ensureEvolutionInstance(
    localId: string,
    instanceKey: string,
    providerInstanceId?: string | null,
    apiKey?: string | null,
    forceRecreate = false,
  ): Promise<EvolutionAuth | null> {
    const baseUrl = this.config.get<string>("EVOLUTION_BASE_URL");
    const globalApiKey = this.config.get<string>("EVOLUTION_GLOBAL_API_KEY");

    if (!baseUrl) {
      return null;
    }

    if (!forceRecreate && providerInstanceId && (apiKey || globalApiKey)) {
      return {
        baseUrl,
        authKey: apiKey || globalApiKey!,
        providerInstanceId,
      };
    }

    if (!globalApiKey) {
      return null;
    }

    const remote = await this.findEvolutionInstance(
      baseUrl,
      globalApiKey,
      instanceKey,
      providerInstanceId,
    );
    if (remote?.id) {
      const authKey = remote.token ?? apiKey ?? globalApiKey;
      await this.prisma.whatsappInstance.update({
        where: { id: localId },
        data: {
          providerInstanceId: remote.id,
          apiKey: authKey,
          lastError: null,
        },
      });
      return { baseUrl, authKey, providerInstanceId: remote.id };
    }

    const token = apiKey || crypto.randomBytes(24).toString("hex");
    const created = await this.tryCreateEvolutionInstance(instanceKey, token);
    if (!created?.providerInstanceId) {
      await this.prisma.whatsappInstance.update({
        where: { id: localId },
        data: {
          providerInstanceId: null,
          qrCode: null,
          status: "ERROR",
          lastError:
            "A Evolution Go não criou a instância. Confira a GLOBAL_API_KEY e tente novamente.",
        },
      });
      return null;
    }

    const authKey = created.token ?? token;
    await this.prisma.whatsappInstance.update({
      where: { id: localId },
      data: {
        providerInstanceId: created.providerInstanceId,
        apiKey: authKey,
        lastError: null,
      },
    });

    return {
      baseUrl,
      authKey,
      providerInstanceId: created.providerInstanceId,
    };
  }

  private async findEvolutionInstance(
    baseUrl: string,
    globalApiKey: string,
    instanceKey: string,
    providerInstanceId?: string | null,
  ): Promise<EvolutionRemoteInstance | null> {
    const response = await axios
      .get(`${baseUrl}/instance/all`, {
        headers: { apikey: globalApiKey },
        timeout: 10000,
      })
      .catch(() => null);
    const items = this.extractRemoteInstances(response?.data);

    return (
      items.find(
        (item) =>
          item.name === instanceKey ||
          (providerInstanceId ? item.id === providerInstanceId : false),
      ) ?? null
    );
  }

  private extractRemoteInstances(data: unknown): EvolutionRemoteInstance[] {
    const value = data as { data?: unknown; instances?: unknown } | unknown[];
    const rows = Array.isArray(value)
      ? value
      : Array.isArray(value?.data)
        ? value.data
        : Array.isArray(value?.instances)
          ? value.instances
          : [];

    return rows
      .map((row) => {
        const item = row as {
          id?: unknown;
          name?: unknown;
          token?: unknown;
          data?: { id?: unknown; name?: unknown; token?: unknown };
        };
        return {
          id: this.stringOrUndefined(item.id ?? item.data?.id),
          name: this.stringOrUndefined(item.name ?? item.data?.name),
          token: this.stringOrUndefined(item.token ?? item.data?.token),
        };
      })
      .filter((item) => item.id || item.name);
  }

  private async fetchQrCode(
    auth: EvolutionAuth,
    instanceKey: string,
  ) {
    const headers = { apikey: auth.authKey, instanceId: auth.providerInstanceId };
    const byName = await axios
      .get(`${auth.baseUrl}/instance/${encodeURIComponent(instanceKey)}/qrcode`, {
        headers,
        timeout: 10000,
      })
      .catch(() => null);

    const fallback = byName
      ? null
      : await axios
          .get(`${auth.baseUrl}/instance/qr`, {
            headers,
            timeout: 10000,
          })
          .catch(() => null);

    return this.extractQrCode(byName?.data ?? fallback?.data);
  }

  private async fetchQrCodeWithRetry(auth: EvolutionAuth, instanceKey: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const qrCode = await this.fetchQrCode(auth, instanceKey);
      if (qrCode) {
        return qrCode;
      }
      await this.sleep(750);
    }
    return null;
  }

  private fetchStatus(auth: EvolutionAuth, instanceKey: string) {
    const headers = { apikey: auth.authKey, instanceId: auth.providerInstanceId };
    return axios
      .get(`${auth.baseUrl}/instance/${encodeURIComponent(instanceKey)}/status`, {
        headers,
        timeout: 10000,
      })
      .catch(() =>
        axios.get(`${auth.baseUrl}/instance/status`, {
          headers,
          timeout: 10000,
        }),
      );
  }

  private extractQrCode(data: unknown) {
    const value = data as {
      code?: string;
      qrcode?: string;
      Qrcode?: string;
      qrCode?: string;
      QRCode?: string;
      data?: {
        code?: string;
        Code?: string;
        qrcode?: string;
        Qrcode?: string;
        qrCode?: string;
        QRCode?: string;
      };
    } | null;

    return (
      value?.data?.qrcode ??
      value?.data?.Qrcode ??
      value?.data?.qrCode ??
      value?.data?.QRCode ??
      value?.data?.code ??
      value?.data?.Code ??
      value?.qrcode ??
      value?.Qrcode ??
      value?.qrCode ??
      value?.QRCode ??
      value?.code ??
      null
    );
  }

  private isConnected(data: unknown) {
    const value = data as {
      connected?: boolean;
      Connected?: boolean;
      status?: string;
      state?: string;
      data?: {
        connected?: boolean;
        Connected?: boolean;
        status?: string;
        state?: string;
      };
    } | null;
    const status = String(
      value?.data?.status ?? value?.data?.state ?? value?.status ?? value?.state ?? "",
    ).toUpperCase();

    const explicit =
      value?.data?.Connected ??
      value?.data?.connected ??
      value?.Connected ??
      value?.connected;

    return Boolean(explicit ?? (status.includes("CONNECTED") || status.includes("OPEN")));
  }

  private async webhookUrl(localId: string, webhookSecret?: string | null) {
    const baseWebhook = await this.settings.getEvolutionWebhookPublicUrl();
    return `${baseWebhook}/${localId}?secret=${webhookSecret ?? ""}`;
  }

  private async tryConfigureEvolutionAdvancedSettings(
    localId: string,
    auth: EvolutionAuth,
  ) {
    try {
      await axios.put(
        `${auth.baseUrl}/instance/${auth.providerInstanceId}/advanced-settings`,
        EVOLUTION_ADVANCED_SETTINGS,
        {
          headers: {
            apikey: auth.authKey,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      return true;
    } catch (error) {
      await this.prisma.whatsappInstance.update({
        where: { id: localId },
        data: {
          lastError: `A Evolution Go não confirmou as configurações avançadas: ${this.errorMessage(error)}`,
        },
      });
      return false;
    }
  }

  private webhookReachabilityError(evolutionBaseUrl: string, webhookUrl: string) {
    const evolutionHost = this.hostname(evolutionBaseUrl);
    const webhookHost = this.hostname(webhookUrl);

    if (!evolutionHost || !webhookHost) {
      return "URL pública do webhook inválida.";
    }

    if (this.isInternalHost(webhookHost) && !this.isInternalHost(evolutionHost)) {
      return "WEBHOOK_PUBLIC_URL aponta para uma URL local/interna, mas a Evolution Go configurada é remota. Configure uma URL pública da API antes de conectar a instância.";
    }

    return null;
  }

  private hostname(value: string) {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  private isLocalHost(hostname: string) {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost")
    );
  }

  private isInternalHost(hostname: string) {
    return (
      this.isLocalHost(hostname) ||
      hostname === "host.docker.internal" ||
      !hostname.includes(".") ||
      this.isPrivateIpv4(hostname)
    );
  }

  private isPrivateIpv4(hostname: string) {
    const parts = hostname.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return false;
    }

    const [first, second] = parts;
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  private evolutionAuth(
    providerInstanceId?: string | null,
    apiKey?: string | null,
  ): EvolutionAuth | null {
    const baseUrl = this.config.get<string>("EVOLUTION_BASE_URL");
    const globalApiKey = this.config.get<string>("EVOLUTION_GLOBAL_API_KEY");
    const authKey = apiKey || globalApiKey;
    if (!baseUrl || !authKey || !providerInstanceId) {
      return null;
    }

    return { baseUrl, authKey, providerInstanceId };
  }

  private async tryLogoutEvolutionInstance(instance: WhatsappInstance) {
    const auth = this.evolutionAuth(
      instance.providerInstanceId,
      instance.apiKey,
    );
    if (!auth) {
      return false;
    }

    const headers = { apikey: auth.authKey, instanceId: auth.providerInstanceId };
    const logout = await axios
      .delete(`${auth.baseUrl}/instance/logout`, { headers, timeout: 10000 })
      .catch(() => null);
    if (logout) {
      await this.prisma.whatsappInstance.update({
        where: { id: instance.id },
        data: { status: "DISCONNECTED", qrCode: null, lastError: null },
      });
      return true;
    }

    const disconnect = await axios
      .post(`${auth.baseUrl}/instance/disconnect`, null, {
        headers,
        timeout: 10000,
      })
      .catch(() => null);
    if (disconnect) {
      await this.prisma.whatsappInstance.update({
        where: { id: instance.id },
        data: { status: "DISCONNECTED", qrCode: null, lastError: null },
      });
      return true;
    }

    return false;
  }

  private shouldRecreateEvolutionInstance(error: unknown) {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const statusCode = error.response?.status;
    const message = this.errorMessage(error).toLowerCase();
    return (
      statusCode === 401 ||
      statusCode === 403 ||
      statusCode === 404 ||
      message.includes("not authorized") ||
      message.includes("unauthorized") ||
      message.includes("not found") ||
      message.includes("instância não encontrada") ||
      message.includes("instance not found")
    );
  }

  private stringOrUndefined(value: unknown) {
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private sleep(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private errorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as
        | { message?: string | string[]; error?: string }
        | string
        | undefined;
      if (typeof data === "string") {
        return data;
      }
      if (Array.isArray(data?.message)) {
        return data.message.join(" ");
      }
      return data?.message ?? data?.error ?? error.message;
    }
    return error instanceof Error ? error.message : "Erro desconhecido.";
  }
}
