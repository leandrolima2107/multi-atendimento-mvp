ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'VIDEO';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'STICKER';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'LOCATION';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CONTACT';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'UNKNOWN';

ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'PENDING';

ALTER TABLE "Message"
  ADD COLUMN "mediaMimeType" TEXT,
  ADD COLUMN "mediaFileName" TEXT,
  ADD COLUMN "mediaSize" INTEGER,
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "storagePath" TEXT;

CREATE INDEX "Message_companyId_type_createdAt_idx" ON "Message"("companyId", "type", "createdAt");
CREATE INDEX "Message_companyId_storagePath_idx" ON "Message"("companyId", "storagePath");
