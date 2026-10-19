-- Employees, managers and Finance no longer edit their own contact details (HR keeps them up to date).
-- Removes the grant from the existing role rows; a Super Admin can grant it again under Roles & permissions.
UPDATE `Role`
SET `permissions` = JSON_REMOVE(`permissions`, JSON_UNQUOTE(JSON_SEARCH(`permissions`, 'one', 'profile.update:self')))
WHERE `key` IN ('EMPLOYEE', 'MANAGER', 'FINANCE') AND JSON_VALID(`permissions`) AND JSON_SEARCH(`permissions`, 'one', 'profile.update:self') IS NOT NULL;
