-- SOURCE ONLY. Requires separately authorized backup, quiesced API/worker writers,
-- migration and regenerated-client deployment before accepting writes again.
-- MySQL DDL is not transactional: inspect partial progress before any failed-run recovery.
-- Existing restrictive FK guarantees every historical Payment has an original Order.
ALTER TABLE `Payment`
    ADD COLUMN `originalOrderId` VARCHAR(30) NULL,
    ADD COLUMN `originalOrderNumber` VARCHAR(50) NULL;

-- Backfill identity only; never rewrite money, method, reference, reason, actor or timestamps.
UPDATE `Payment` AS p
INNER JOIN `Order` AS o ON o.`id` = p.`orderId`
SET p.`originalOrderId` = o.`id`, p.`originalOrderNumber` = o.`number`;

-- Keep RESTRICT until identity is populated. Missing evidence fails this ALTER rather
-- than permitting deletion. No defaults: outdated writers must fail, not invent evidence.
ALTER TABLE `Payment`
    MODIFY `originalOrderId` VARCHAR(30) NOT NULL,
    MODIFY `originalOrderNumber` VARCHAR(50) NOT NULL,
    ADD CONSTRAINT `Payment_original_identity_check` CHECK (CHAR_LENGTH(`originalOrderId`) > 0 AND CHAR_LENGTH(`originalOrderNumber`) > 0),
    DROP FOREIGN KEY `Payment_orderId_fkey`,
    MODIFY `orderId` VARCHAR(30) NULL,
    ADD CONSTRAINT `Payment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
