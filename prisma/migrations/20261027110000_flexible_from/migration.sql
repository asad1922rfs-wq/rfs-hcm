-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `flexibleFrom` DATE NULL;

-- Current remote employees: flexible hours (9h minimum) from 28 Oct 2026; earlier days are credited.
UPDATE `Employee` SET `flexibleFrom` = '2026-10-28' WHERE `workMode` = 'REMOTE';
