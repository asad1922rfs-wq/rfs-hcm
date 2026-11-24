-- Grace period (and optional timing) for a range of days in every month, per shift.
CREATE TABLE `ShiftDateRule` (
    `id` VARCHAR(191) NOT NULL,
    `shiftId` VARCHAR(191) NOT NULL,
    `fromDay` INTEGER NOT NULL,
    `toDay` INTEGER NOT NULL,
    `startMinute` INTEGER NULL,
    `endMinute` INTEGER NULL,
    `graceMinutes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ShiftDateRule_shiftId_idx`(`shiftId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ShiftDateRule` ADD CONSTRAINT `ShiftDateRule_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
