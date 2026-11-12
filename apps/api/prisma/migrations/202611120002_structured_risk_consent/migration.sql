-- Additive only. Historical descriptions remain untouched; no backfill.
ALTER TABLE `Inspection`
  ADD COLUMN `findings` TEXT NULL,
  ADD COLUMN `customerNote` TEXT NULL;

ALTER TABLE `ConsentDecision`
  ADD COLUMN `findings` TEXT NULL,
  ADD COLUMN `customerNote` TEXT NULL;
