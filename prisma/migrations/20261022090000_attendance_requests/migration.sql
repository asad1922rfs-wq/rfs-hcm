-- Attendance (late waiver) requests: an employee asks for a late day to be waived; approved only when the day's
-- worked time covers the shift, after which the day counts as Present.
-- CreateTable
CREATE TABLE `AttendanceRequest` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `workDate` DATE NOT NULL,
    `reasonKey` VARCHAR(40) NOT NULL,
    `reasonText` VARCHAR(200) NOT NULL,
    `note` VARCHAR(300) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `workedMinutes` INTEGER NULL,
    `requiredMinutes` INTEGER NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AttendanceRequest_employeeId_workDate_idx`(`employeeId`, `workDate`),
    INDEX `AttendanceRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AttendanceRequest` ADD CONSTRAINT `AttendanceRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing roles keep the grants they were created with, so the new defaults (src/server/auth/permissions.ts
-- SYSTEM_ROLES) are appended here. Each statement skips roles that already have the grant, so it is safe to re-run.
-- Super Admin has "*" and needs nothing.
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'attendance.request:self')
WHERE `key` IN ('EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'FINANCE') AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"attendance.request:self"');

UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'attendance.approve:all')
WHERE `key` = 'HR_ADMIN' AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"attendance.approve:all"');

UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'attendance.approve:team')
WHERE `key` = 'MANAGER' AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"attendance.approve:team"');
