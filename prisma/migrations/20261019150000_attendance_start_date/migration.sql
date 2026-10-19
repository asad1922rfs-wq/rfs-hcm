-- AlterTable
ALTER TABLE `Company` ADD COLUMN `attendanceStartDate` DATE NULL;

-- Attendance before October 2026 was managed in FlowHCM (its corrections are not in this system).
UPDATE `Company` SET `attendanceStartDate` = '2026-10-01' WHERE `attendanceStartDate` IS NULL;
