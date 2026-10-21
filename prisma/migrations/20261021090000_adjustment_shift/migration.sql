-- An attendance edit can judge that one day against a different shift (e.g. 3rd shift instead of the usual one).
-- Empty on existing edits, which keep using the employee's own shift.
-- AlterTable
ALTER TABLE `AttendanceAdjustment` ADD COLUMN `shiftId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `AttendanceAdjustment` ADD CONSTRAINT `AttendanceAdjustment_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
