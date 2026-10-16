-- AlterTable
ALTER TABLE "AttendanceAdjustment" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "excused" BOOLEAN NOT NULL DEFAULT false;
