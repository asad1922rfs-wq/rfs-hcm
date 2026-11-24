-- Replace day-of-month grace rules with a dated grace history per shift.
DROP TABLE IF EXISTS `ShiftDateRule`;

CREATE TABLE IF NOT EXISTS `ShiftGraceStep` (
    `id` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATE NOT NULL,
    `graceMinutes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShiftGraceStep_shiftId_effectiveFrom_key`(`shiftId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ShiftGraceStep` ADD CONSTRAINT `ShiftGraceStep_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
