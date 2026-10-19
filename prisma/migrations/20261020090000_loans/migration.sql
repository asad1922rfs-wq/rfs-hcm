-- CreateTable
CREATE TABLE `Loan` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `installments` INTEGER NOT NULL,
    `installmentAmount` DECIMAL(14, 2) NOT NULL,
    `startYear` INTEGER NOT NULL,
    `startMonth` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `requestedById` VARCHAR(191) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(1000) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelNote` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Loan_employeeId_status_idx`(`employeeId`, `status`),
    INDEX `Loan_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoanRepayment` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `source` ENUM('PAYROLL', 'CASH') NOT NULL,
    `payrollItemId` VARCHAR(191) NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `paidOn` DATE NOT NULL,
    `note` VARCHAR(500) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LoanRepayment_loanId_payrollItemId_key`(`loanId`, `payrollItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoanPause` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LoanPause_loanId_year_month_key`(`loanId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Loan` ADD CONSTRAINT `Loan_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanRepayment` ADD CONSTRAINT `LoanRepayment_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanRepayment` ADD CONSTRAINT `LoanRepayment_payrollItemId_fkey` FOREIGN KEY (`payrollItemId`) REFERENCES `PayrollItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanPause` ADD CONSTRAINT `LoanPause_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing roles keep the grants they were created with, so the new loan defaults (src/server/auth/permissions.ts
-- SYSTEM_ROLES) are appended here. Each statement skips roles that already have the grant, so it is safe to re-run.
-- Super Admin has "*" and needs nothing.
UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'loan.request:self')
WHERE `key` IN ('EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'FINANCE') AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"loan.request:self"');

UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'loan.read:self')
WHERE `key` = 'EMPLOYEE' AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"loan.read:self"');

UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'loan.read:team')
WHERE `key` = 'MANAGER' AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"loan.read:team"');

UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'loan.read:all')
WHERE `key` IN ('HR_ADMIN', 'FINANCE') AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"loan.read:all"');

UPDATE `Role` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'loan.manage:all')
WHERE `key` IN ('HR_ADMIN', 'FINANCE') AND JSON_VALID(`permissions`) AND NOT JSON_CONTAINS(`permissions`, '"loan.manage:all"');
