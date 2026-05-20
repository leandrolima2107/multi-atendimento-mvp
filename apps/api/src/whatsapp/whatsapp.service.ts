import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WhatsappInstance } from "@prisma/client";
import axios from "axios";
import crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateWhatsappInstanceDto } from "./whatsapp.dto";

type SafeWhatsappInstance = Omit<
  WhatsappInstance,
  "apiKey" | "webhookSecret" | "providerInstanceId"
>;
type EvolutionCreateResult = {
  providerInstanceId?: string;
  token?: string;
};

@Injectable()
export class WhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async list(companyId: string) {
    const instances = await this.prisma.whatsappInstance.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });

    return instances.map((instance) => this.sanitizeInstance(instance));
  }

  async create(companyId: string, dto: CreateWhatsappInstanceDto) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { plan: true, _count: { select: { whatsappInstances: true } } },
    });

    const limit = company.plan?.maxWhatsappInstances ?? 1;
    if (company._count.whatsappInstances >= limit) {
      throw new BadRequestException(
        "Limite de números WhatsApp do plano atingido.",
      );
    }

    const instanceKey = `${company.slug}-${crypto.randomBytes(4).toString("hex")}`;
    const webhookSecret = crypto.randomBytes(24).toString("hex");
    const apiKey = crypto.randomBytes(24).toString("hex");
    const webhookUrl = `${this.config.get("WEBHOOK_PUBLIC_URL", "http://localhost:4000/webhooks/evolution")}/${instanceKey}?secret=${webhookSecret}`;

    const instance = await this.prisma.whatsappInstance.create({
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

    const evolution = await this.tryCreateEvolutionInstance(instanceKey, apiKey);
    const updated = await this.prisma.whatsappInstance.update({
      where: { id: instance.id },
      data: {
        providerInstanceId: evolution?.providerInstanceId,
        apiKey: evolution?.token ?? apiKey,
      },
    });

    void webhookUrl;
    return this.sanitizeInstance(updated);
  }

  async connect(companyId: string, id: string) {
    const instance = await this.getOwned(companyId, id);
    const qrCode = await this.tryConnectEvolutionInstance(
      instance.id,
      instance.providerInstanceId,
      instance.apiKey ?? undefined,
      instance.webhookSecret,
      instance.phoneNumber,
    );

    const refreshed = await this.refreshEvolutionStatus(instance.id);
    const updated = refreshed
      ? await this.getOwned(companyId, id)
      : await this.prisma.whatsappInstance.update({
          where: { id },
          data: {
            status: qrCode ? "QR_PENDING" : "CREATED",
            qrCode,
            lastError: null,
          },
        });

    return this.sanitizeInstance(updated);
  }

  async refreshStatus(companyId: string, id: string) {
    await this.refreshEvolutionStatus(id);
    const instance = await this.getOwned(companyId, id);
    return this.sanitizeInstance(instance);
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
    providerInstanceId?: string | null,
    apiKey?: string | null,
    webhookSecret?: string | null,
    phoneNumber?: string | null,
  ) {
    const baseUrl = this.config.get<string>("EVOLUTION_BASE_URL");
    if (!baseUrl || !apiKey || !providerInstanceId) {
      return null;
    }

    try {
      await axios.post(
        `${baseUrl}/instance/connect`,
        {
          webhookUrl: this.webhookUrl(localId, webhookSecret),
          subscribe: [
            "MESSAGE",
            "SEND_MESSAGE",
            "CONNECTION",
            "QRCODE",
            "READ_RECEIPT",
          ],
          immediate: true,
          phone: phoneNumber || undefined,
        },
        {
          headers: { apikey: apiKey, instanceId: providerInstanceId },
          timeout: 10000,
        },
      );
      const qr = await axios.get(`${baseUrl}/instance/qr`, {
        headers: { apikey: apiKey, instanceId: providerInstanceId },
        timeout: 10000,
      });
      return qr.data?.data?.code ?? qr.data?.data?.qrcode ?? null;
    } catch (error) {
      await this.prisma.whatsappInstance.update({
        where: { id: localId },
        data: { status: "ERROR", lastError: this.errorMessage(error) },
      });
      return null;
    }
  }

  private async refreshEvolutionStatus(localId: string) {
    const instance = await this.prisma.whatsappInstance.findUnique({
      where: { id: localId },
    });
    const baseUrl = this.config.get<string>("EVOLUTION_BASE_URL");
    if (!instance?.apiKey || !instance.providerInstanceId || !baseUrl) {
      return false;
    }

    try {
      const response = await axios.get(`${baseUrl}/instance/status`, {
        headers: {
          apikey: instance.apiKey,
          instanceId: instance.providerInstanceId,
        },
        timeout: 10000,
      });
      const connected = Boolean(
        response.data?.data?.Connected ?? response.data?.data?.connected,
      );
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
      data?: { id?: string; token?: string; instance?: { id?: string } };
      id?: string;
      token?: string;
      instance?: { id?: string };
    };

    return {
      providerInstanceId:
        value.data?.id ?? value.data?.instance?.id ?? value.id ?? value.instance?.id,
      token: value.data?.token ?? value.token,
    };
  }

  private webhookUrl(localId: string, webhookSecret?: string | null) {
    const baseWebhook = this.config.get(
      "WEBHOOK_PUBLIC_URL",
      "http://localhost:4000/webhooks/evolution",
    );
    return `${baseWebhook}/${localId}?secret=${webhookSecret ?? ""}`;
  }

  private errorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
      return error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
    }
    return error instanceof Error ? error.message : "Erro desconhecido.";
  }
}
