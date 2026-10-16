-- CreateEnum
CREATE TYPE "PunchSource" AS ENUM ('IMPORT', 'AGENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'EARLY', 'HALF_DAY', 'SHORT_DAY', 'ABSENT', 'LEAVE', 'MISSING');

-- CreateTable
CREATE TABLE "RawPunch" (
    "id" TEXT NOT NULL,
    "source" "PunchSource" NOT NULL,
    "deviceSerial" TEXT NOT NULL DEFAULT '',
    "deviceUserId" TEXT NOT NULL,
    "punchedAt" TIMESTAMP(3) NOT NULL,
    "deviceLocal" TEXT NOT NULL,
    "punchState" TEXT,
    "verifyMode" TEXT,
    "employeeId" TEXT,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawPunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PunchImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "rowsRead" INTEGER NOT NULL,
    "inserted" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "unmatched" INTEGER NOT NULL,
    "invalid" INTEGER NOT NULL,
    "firstPunchAt" TIMESTAMP(3),
    "lastPunchAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PunchImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "firstIn" TIMESTAMP(3),
    "lastOut" TIMESTAMP(3),
    "punchCount" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "isOffDay" BOOLEAN NOT NULL DEFAULT false,
    "shiftId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawPunch_employeeId_punchedAt_idx" ON "RawPunch"("employeeId", "punchedAt");

-- CreateIndex
CREATE INDEX "RawPunch_deviceUserId_idx" ON "RawPunch"("deviceUserId");

-- CreateIndex
CREATE INDEX "RawPunch_punchedAt_idx" ON "RawPunch"("punchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawPunch_deviceSerial_deviceUserId_punchedAt_key" ON "RawPunch"("deviceSerial", "deviceUserId", "punchedAt");

-- CreateIndex
CREATE INDEX "AttendanceDay_workDate_idx" ON "AttendanceDay"("workDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_employeeId_workDate_key" ON "AttendanceDay"("employeeId", "workDate");

-- AddForeignKey
ALTER TABLE "RawPunch" ADD CONSTRAINT "RawPunch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawPunch" ADD CONSTRAINT "RawPunch_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PunchImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
