-- Loans no longer have a fixed monthly plan: each month deducts only the installment HR entered for it
-- (LoanMonthOverride.amount > 0). The old plan columns become optional and are left as they are on existing loans,
-- which simply stop being deducted automatically. Nothing is converted.
-- AlterTable
ALTER TABLE `Loan` MODIFY `installments` INTEGER NULL,
    MODIFY `installmentAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `givenOn` DATE NULL;
