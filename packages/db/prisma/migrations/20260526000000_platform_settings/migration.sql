CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "PlatformSetting_updatedAt_idx" ON "PlatformSetting"("updatedAt");
