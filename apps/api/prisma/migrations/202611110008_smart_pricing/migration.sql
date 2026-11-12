-- Nullable snapshot: historical manual orders remain unchanged; old workers need no new fields.
ALTER TABLE `Order` ADD COLUMN `pricing` JSON NULL;
