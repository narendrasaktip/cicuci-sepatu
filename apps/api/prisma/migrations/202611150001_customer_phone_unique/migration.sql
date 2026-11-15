-- Fails without changing customer data if legacy numbers are not normalized.
-- Resolve invalid numbers and duplicates manually before deployment; preserve order history.
ALTER TABLE `Customer`
  ADD CONSTRAINT `Customer_whatsapp_normalized_check` CHECK (`whatsapp` REGEXP '^[+][1-9][0-9]{7,14}$'),
  ADD UNIQUE INDEX `Customer_whatsapp_key` (`whatsapp`);
