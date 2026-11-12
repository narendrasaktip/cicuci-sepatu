-- Additive only. No history/template/notification rewrites, replay or deletion.
ALTER TABLE `Customer` ADD COLUMN `salutation` VARCHAR(3) NOT NULL DEFAULT 'Kak', ADD COLUMN `archivedAt` DATETIME(3) NULL;
ALTER TABLE `Order` ADD COLUMN `archivedAt` DATETIME(3) NULL;
ALTER TABLE `RatePlan` ADD COLUMN `archivedAt` DATETIME(3) NULL;
ALTER TABLE `User` ADD COLUMN `archivedAt` DATETIME(3) NULL;
