ALTER TABLE `StoreSettings` ADD COLUMN `waActivation` VARCHAR(36) NULL;
ALTER TABLE `NotificationEvent` ADD COLUMN `provider` VARCHAR(30) NOT NULL DEFAULT 'mock', ADD COLUMN `activation` VARCHAR(36) NULL;
