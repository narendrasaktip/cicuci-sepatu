-- Additive only. Never alters historical services/orders or overwrites edited plans.
CREATE TABLE IF NOT EXISTS `RatePlan` (
  `id` VARCHAR(30) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `rules` JSON NOT NULL,
  UNIQUE INDEX `RatePlan_name_key` (`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `RatePlan` (`id`, `name`, `rules`)
SELECT 'cicuci-rate-promo-v1', 'Promo', JSON_ARRAY(
  JSON_OBJECT('kind','PACKAGE','minPairs',1,'maxPairs',1,'priceIdr',45000),
  JSON_OBJECT('kind','PACKAGE','minPairs',3,'maxPairs',3,'priceIdr',130000),
  JSON_OBJECT('kind','PACKAGE','minPairs',5,'maxPairs',5,'priceIdr',210000),
  JSON_OBJECT('kind','PER_PAIR','minPairs',6,'maxPairs',9,'priceIdr',41000),
  JSON_OBJECT('kind','PER_PAIR','minPairs',10,'maxPairs',NULL,'priceIdr',40000)
) WHERE NOT EXISTS (SELECT 1 FROM `RatePlan` WHERE `id` = 'cicuci-rate-promo-v1' OR `name` = 'Promo');

INSERT INTO `RatePlan` (`id`, `name`, `rules`)
SELECT 'cicuci-rate-normal-v1', 'Normal', JSON_ARRAY(
  JSON_OBJECT('kind','PACKAGE','minPairs',1,'maxPairs',1,'priceIdr',50000),
  JSON_OBJECT('kind','PACKAGE','minPairs',3,'maxPairs',3,'priceIdr',145000),
  JSON_OBJECT('kind','PACKAGE','minPairs',5,'maxPairs',5,'priceIdr',225000),
  JSON_OBJECT('kind','PER_PAIR','minPairs',6,'maxPairs',9,'priceIdr',45000),
  JSON_OBJECT('kind','PER_PAIR','minPairs',10,'maxPairs',NULL,'priceIdr',43000)
) WHERE NOT EXISTS (SELECT 1 FROM `RatePlan` WHERE `id` = 'cicuci-rate-normal-v1' OR `name` = 'Normal');
