-- CreateEnum
CREATE TYPE "AgentCommandStatus" AS ENUM ('PENDING', 'SENT', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "SyncAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "outboxCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDevice" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT,
    "model" TEXT,
    "firmware" TEXT,
    "pushVersion" TEXT,
    "agentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastPunchAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCommand" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "deviceSerial" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AgentCommandStatus" NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDevice_serialNumber_key" ON "AttendanceDevice"("serialNumber");

-- CreateIndex
CREATE INDEX "AgentCommand_agentId_status_idx" ON "AgentCommand"("agentId", "status");

-- AddForeignKey
ALTER TABLE "AttendanceDevice" ADD CONSTRAINT "AttendanceDevice_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SyncAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCommand" ADD CONSTRAINT "AgentCommand_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SyncAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
