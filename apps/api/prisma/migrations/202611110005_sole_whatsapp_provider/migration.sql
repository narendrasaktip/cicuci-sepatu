-- Forward default only. Historical provider/status/attempts remain unchanged.
ALTER TABLE `NotificationEvent` ALTER COLUMN `provider` SET DEFAULT 'whatsapp-web.js';
