-- CreateTable
CREATE TABLE `EmployeeDocument` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `category` ENUM('CNIC', 'CV', 'OFFER_LETTER', 'CONTRACT', 'EDUCATION', 'EXPERIENCE', 'MEDICAL', 'OTHER') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(300) NOT NULL,
    `expiresOn` DATE NULL,
    `uploadedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmployeeDocument_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmployeeDocument` ADD CONSTRAINT `EmployeeDocument_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing roles keep the grants they were created with, so the new document defaults (src/server/auth/permissions.ts
-- SYSTEM_ROLES) are appended here. Each statement skips roles that already have the grant, so it is safe to re-run.
-- Documents are private: managers get their own only, not their team's. Super Admin has "*" and needs nothing.
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'document.read:self')
WHERE `key` IN ('EMPLOYEE', 'MANAGER', 'FINANCE') AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"document.read:self"');

UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'document.read:all')
WHERE `key` = 'HR_ADMIN' AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"document.read:all"');

UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'document.manage:all')
WHERE `key` = 'HR_ADMIN' AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"document.manage:all"');
