-- CreateTable
CREATE TABLE "ShiftDayOverride" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "graceMinutes" INTEGER,

    CONSTRAINT "ShiftDayOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftDayOverride_shiftId_weekday_key" ON "ShiftDayOverride"("shiftId", "weekday");

-- AddForeignKey
ALTER TABLE "ShiftDayOverride" ADD CONSTRAINT "ShiftDayOverride_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
