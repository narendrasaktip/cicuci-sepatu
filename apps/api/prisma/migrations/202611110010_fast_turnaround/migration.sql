-- Additive: existing plans keep regular scheduling; historical orders untouched.
ALTER TABLE `RatePlan` ADD COLUMN `turnaroundPolicy` VARCHAR(10) NOT NULL DEFAULT 'REGULAR';

-- Insert once. Never overwrite an owner's matching name or edited plan.
INSERT INTO `RatePlan` (`id`, `name`, `turnaroundPolicy`, `rules`)
SELECT 'cicuci-rate-fast-v1', 'Fast', 'FAST', JSON_ARRAY(
  JSON_OBJECT('kind','PACKAGE','minPairs',1,'maxPairs',1,'priceIdr',80000)
) WHERE NOT EXISTS (SELECT 1 FROM `RatePlan` WHERE `id` = 'cicuci-rate-fast-v1' OR `name` = 'Fast');
