import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 10 * 60;

type StoredMedia = {
  storagePath: string;
  mediaMimeType: string;
  mediaFileName: string;
  mediaSize: number;
};

type StoreBase64Input = {
  companyId: string;
  conversationId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  declaredSize: number;
  dataBase64: string;
};

type StoreRemoteInput = {
  companyId: string;
  conversationId: string;
  messageId: string;
  sourceUrl: string;
  fileName?: string;
  mimeType?: string;
  apiKey?: string | null;
  providerInstanceId?: string | null;
};

type StoreBufferInput = {
  companyId: string;
  conversationId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

type SignedMedia = {
  stream: ReadStream;
  mimeType: string;
  fileName: string;
  size: number;
};

@Injectable()
export class MediaStorageService {
  private readonly storageRoot: string;
  private readonly maxBytes: number;
  private readonly signedUrlTtlSeconds: number;
  private readonly signingSecret: string;
  private readonly publicUrlPrefix: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.storageRoot = path.resolve(
      this.config.get<string>('MEDIA_STORAGE_DIR') ?? path.join(process.cwd(), '.media'),
    );
    this.maxBytes = Number(this.config.get<string>('MAX_MEDIA_UPLOAD_BYTES') ?? DEFAULT_MAX_MEDIA_BYTES);
    this.signedUrlTtlSeconds = Number(
      this.config.get<string>('MEDIA_SIGNED_URL_TTL_SECONDS') ?? DEFAULT_SIGNED_URL_TTL_SECONDS,
    );
    this.signingSecret = this.resolveSigningSecret();
    this.publicUrlPrefix = this.normalizePublicUrlPrefix(
      this.config.get<string>('MEDIA_PUBLIC_URL_PREFIX') ?? '/api/backend',
    );
  }

  getMaxBytes() {
    return this.maxBytes;
  }

  async storeBase64(input: StoreBase64Input): Promise<StoredMedia> {
    const buffer = this.decodeBase64(input.dataBase64);
    if (buffer.byteLength !== input.declaredSize) {
      throw new BadRequestException('O arquivo enviado não corresponde ao tamanho informado.');
    }
    this.assertAllowedSize(buffer.byteLength);

    return this.storeBuffer({
      companyId: input.companyId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      buffer,
    });
  }

  async storeRemote(input: StoreRemoteInput): Promise<StoredMedia | null> {
    if (!input.sourceUrl.startsWith('http://') && !input.sourceUrl.startsWith('https://')) {
      return null;
    }

    const response = await axios.get<ArrayBuffer>(input.sourceUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: this.maxBytes,
      headers: this.remoteHeaders(input),
    });
    const buffer = Buffer.from(response.data);
    this.assertAllowedSize(buffer.byteLength);

    return this.storeBuffer({
      companyId: input.companyId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      fileName: input.fileName ?? this.fileNameFromUrl(input.sourceUrl) ?? input.messageId,
      mimeType: input.mimeType ?? this.headerValue(response.headers['content-type']) ?? 'application/octet-stream',
      buffer,
    });
  }

  signedUrlFor(message: { id: string; companyId: string; storagePath?: string | null }) {
    if (!message.storagePath) {
      return null;
    }

    const expiresAt = Math.floor(Date.now() / 1000) + this.signedUrlTtlSeconds;
    const signature = this.sign(message.id, message.companyId, message.storagePath, expiresAt);
    const params = new URLSearchParams({ expires: String(expiresAt), signature });
    return `${this.publicUrlPrefix}/atendimentos/media/${encodeURIComponent(message.id)}?${params.toString()}`;
  }

  async readSignedMedia(messageId: string, expires: string | undefined, signature: string | undefined): Promise<SignedMedia> {
    const expiresAt = Number(expires);
    if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) || !signature) {
      throw new UnauthorizedException('Link de mídia expirado.');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        companyId: true,
        storagePath: true,
        mediaMimeType: true,
        mediaFileName: true,
        mediaSize: true,
      },
    });

    if (!message?.storagePath) {
      throw new NotFoundException('Mídia não encontrada.');
    }

    const expected = this.sign(message.id, message.companyId, message.storagePath, expiresAt);
    if (!this.safeEqual(signature, expected)) {
      throw new UnauthorizedException('Link de mídia inválido.');
    }

    const absolutePath = this.toAbsolutePath(message.storagePath);
    const fileStat = await stat(absolutePath);

    return {
      stream: createReadStream(absolutePath),
      mimeType: message.mediaMimeType ?? 'application/octet-stream',
      fileName: message.mediaFileName ?? message.id,
      size: message.mediaSize ?? fileStat.size,
    };
  }

  private async storeBuffer(input: StoreBufferInput): Promise<StoredMedia> {
    const mediaFileName = this.safeFileName(input.fileName);
    const storagePath = path.posix.join(
      'companies',
      input.companyId,
      'conversations',
      input.conversationId,
      'messages',
      input.messageId,
      mediaFileName,
    );
    const absolutePath = this.toAbsolutePath(storagePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.buffer);

    return {
      storagePath,
      mediaMimeType: input.mimeType,
      mediaFileName,
      mediaSize: input.buffer.byteLength,
    };
  }

  private assertAllowedSize(size: number) {
    if (size <= 0) {
      throw new BadRequestException('O arquivo enviado está vazio.');
    }
    if (size > this.maxBytes) {
      throw new BadRequestException(`O arquivo excede o limite de ${this.formatBytes(this.maxBytes)}.`);
    }
  }

  private decodeBase64(value: string) {
    const base64 = value.includes(',') ? value.split(',').pop() ?? '' : value;
    if (!base64.trim()) {
      throw new BadRequestException('Arquivo inválido para envio.');
    }
    return Buffer.from(base64, 'base64');
  }

  private remoteHeaders(input: StoreRemoteInput) {
    const headers: Record<string, string> = {};
    if (input.apiKey) {
      headers.apikey = input.apiKey;
    }
    if (input.providerInstanceId) {
      headers.instanceId = input.providerInstanceId;
    }
    return headers;
  }

  private toAbsolutePath(storagePath: string) {
    const segments = storagePath.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '..' || path.isAbsolute(segment))) {
      throw new BadRequestException('Caminho de mídia inválido.');
    }

    const absolutePath = path.resolve(this.storageRoot, ...segments);
    const rootWithSeparator = this.storageRoot.endsWith(path.sep) ? this.storageRoot : `${this.storageRoot}${path.sep}`;
    if (absolutePath !== this.storageRoot && !absolutePath.startsWith(rootWithSeparator)) {
      throw new BadRequestException('Caminho de mídia inválido.');
    }
    return absolutePath;
  }

  private sign(messageId: string, companyId: string, storagePath: string, expiresAt: number) {
    return createHmac('sha256', this.signingSecret)
      .update(`${messageId}:${companyId}:${storagePath}:${expiresAt}`)
      .digest('hex');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private safeFileName(fileName: string) {
    const clean = fileName
      .normalize('NFKD')
      .replace(/[^\w.\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 120);
    return clean || 'arquivo';
  }

  private fileNameFromUrl(value: string) {
    try {
      const url = new URL(value);
      const baseName = path.posix.basename(url.pathname);
      return baseName && baseName !== '/' ? decodeURIComponent(baseName) : null;
    } catch {
      return null;
    }
  }

  private headerValue(value: unknown) {
    if (Array.isArray(value)) {
      return typeof value[0] === 'string' ? value[0] : undefined;
    }
    return typeof value === 'string' ? value : undefined;
  }

  private normalizePublicUrlPrefix(value: string) {
    const trimmed = value.trim().replace(/\/$/, '');
    return trimmed || '/api/backend';
  }

  private resolveSigningSecret() {
    const mediaSecret = this.config.get<string>('MEDIA_SIGNING_SECRET');
    const jwtSecret = this.config.get<string>('JWT_SECRET');
    const nodeEnv = this.config.get<string>('NODE_ENV');
    const signingSecret = mediaSecret ?? (nodeEnv === 'production' ? undefined : jwtSecret);

    if (!signingSecret) {
      throw new Error('MEDIA_SIGNING_SECRET precisa estar configurado para assinar mídias privadas.');
    }
    if (nodeEnv === 'production' && signingSecret.length < 32) {
      throw new Error('MEDIA_SIGNING_SECRET precisa ter pelo menos 32 caracteres em produção.');
    }

    return signingSecret;
  }

  private formatBytes(value: number) {
    return `${Math.round(value / 1024 / 1024)} MB`;
  }
}
