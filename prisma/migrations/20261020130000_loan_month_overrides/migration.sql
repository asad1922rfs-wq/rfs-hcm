-- Paused months become per-month installment overrides. Existing pause rows keep amount NULL, which means "skip".
-- DropForeignKey
ALTER TABLE `LoanPause` DROP FOREIGN KEY `LoanPause_loanId_fkey`;

-- RenameTable
RENAME TABLE `LoanPause` TO `LoanMonthOverride`;

-- RenameIndex
ALTER TABLE `LoanMonthOverride` RENAME INDEX `LoanPause_loanId_year_month_key` TO `LoanMonthOverride_loanId_year_month_key`;

-- AlterTable
ALTER TABLE `LoanMonthOverride` ADD COLUMN `amount` DECIMAL(14, 2) NULL;

-- AddForeignKey
ALTER TABLE `LoanMonthOverride` ADD CONSTRAINT `LoanMonthOverride_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Employees no longer request loans; only HR/Finance add them. The permission is removed from every existing role.
-- Each statement removes one occurrence, so it is repeated to also clear duplicates; it is a no-op once none is left.
UPDATE `Role` SET `permissions` = JSON_REMOVE(`permissions`, JSON_UNQUOTE(JSON_SEARCH(`permissions`, 'one', 'loan.request:self')))
WHERE JSON_VALID(`permissions`) AND JSON_SEARCH(`permissions`, 'one', 'loan.request:self') IS NOT NULL;

UPDATE `Role` SET `permissions` = JSON_REMOVE(`permissions`, JSON_UNQUOTE(JSON_SEARCH(`permissions`, 'one', 'loan.request:self')))
WHERE JSON_VALID(`permissions`) AND JSON_SEARCH(`permissions`, 'one', 'loan.request:self') IS NOT NULL;

UPDATE `Role` SET `permissions` = JSON_REMOVE(`permissions`, JSON_UNQUOTE(JSON_SEARCH(`permissions`, 'one', 'loan.request:self')))
WHERE JSON_VALID(`permissions`) AND JSON_SEARCH(`permissions`, 'one', 'loan.request:self') IS NOT NULL;
