-- Client rule: leave is not allowed during probation; only permanent employees avail Annual and Sick leave.
-- A leave type flagged permanentOnly can be taken (and approved) only while the employee's employment type is PERMANENT.
ALTER TABLE `LeaveType` ADD COLUMN `permanentOnly` BOOLEAN NOT NULL DEFAULT false;

-- The existing paid types (Annual Leave, Sick Leave) become permanent-only; unpaid types stay open to everyone.
UPDATE `LeaveType` SET `permanentOnly` = true WHERE `isPaid` = 1;
