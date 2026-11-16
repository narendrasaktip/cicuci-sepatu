CREATE TABLE `Feedback` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `rating` TINYINT UNSIGNED NOT NULL,
    `review` VARCHAR(1000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Feedback_orderId_key`(`orderId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Feedback_rating_check` CHECK (`rating` BETWEEN 1 AND 5),
    CONSTRAINT `Feedback_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
