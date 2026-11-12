ALTER TABLE `StoreSettings` ADD COLUMN `waTemplates` JSON NULL;
ALTER TABLE `Order` ADD COLUMN `trackingSecret` TEXT NULL;
ALTER TABLE `NotificationEvent` ADD COLUMN `encryptedMessage` TEXT NULL;
