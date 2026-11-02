-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `isSales` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `SalesMonth` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `target` DECIMAL(14, 2) NOT NULL,
    `achieved` DECIMAL(14, 2) NOT NULL,
    `commission` DECIMAL(14, 2) NOT NULL,
    `note` VARCHAR(500) NULL,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesMonth_employeeId_year_month_key`(`employeeId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SalesMonth` ADD CONSTRAINT `SalesMonth_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
