-- AlterTable
ALTER TABLE `NotificationEvent` ADD COLUMN `expectedStatus` VARCHAR(30) NULL,
    ADD COLUMN `generation` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `itemId` VARCHAR(30) NULL,
    ADD COLUMN `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `orderId` VARCHAR(30) NULL;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `whatsapp` VARCHAR(20) NOT NULL,
    `notes` TEXT NULL,
    `notificationConsentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Customer_whatsapp_idx`(`whatsapp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Service` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `basePriceIdr` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreSettings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(100) NOT NULL DEFAULT 'Cicuci Sepatu',
    `pickupInstructions` TEXT NOT NULL DEFAULT '',
    `consentHours` INTEGER NOT NULL DEFAULT 48,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(30) NOT NULL,
    `number` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(30) NOT NULL,
    `estimatedCompletionAt` DATETIME(3) NOT NULL,
    `pickupInstructions` TEXT NOT NULL,
    `aggregateStatus` VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
    `trackingHash` CHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Order_number_key`(`number`),
    UNIQUE INDEX `Order_trackingHash_key`(`trackingHash`),
    INDEX `Order_aggregateStatus_createdAt_idx`(`aggregateStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItem` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `serviceId` VARCHAR(30) NOT NULL,
    `serviceName` VARCHAR(100) NOT NULL,
    `brand` VARCHAR(100) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `color` VARCHAR(100) NOT NULL,
    `initialNotes` TEXT NOT NULL,
    `assignedUserId` VARCHAR(30) NULL,
    `status` ENUM('RECEIVED', 'INSPECTION', 'AWAITING_CONSENT', 'QUEUED', 'WASHING', 'DRYING', 'FINISHING', 'QC', 'REWORK', 'READY_FOR_PICKUP', 'HANDED_OVER', 'RETURN_PENDING', 'RETURNED') NOT NULL DEFAULT 'RECEIVED',
    `quotedPriceIdr` INTEGER NOT NULL,
    `finalPriceIdr` INTEGER NOT NULL DEFAULT 0,
    `outcome` VARCHAR(30) NULL,
    `qcPassed` BOOLEAN NOT NULL DEFAULT false,

    INDEX `OrderItem_orderId_idx`(`orderId`),
    INDEX `OrderItem_assignedUserId_status_idx`(`assignedUserId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Inspection` (
    `id` VARCHAR(30) NOT NULL,
    `itemId` VARCHAR(30) NOT NULL,
    `outcome` VARCHAR(30) NOT NULL,
    `notes` TEXT NOT NULL,
    `risk` TEXT NOT NULL,
    `quotedPriceIdr` INTEGER NOT NULL,
    `actorUserId` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Inspection_itemId_key`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsentDecision` (
    `id` VARCHAR(30) NOT NULL,
    `itemId` VARCHAR(30) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `risk` TEXT NOT NULL,
    `quotedPriceIdr` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `decision` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ConsentDecision_tokenHash_key`(`tokenHash`),
    INDEX `ConsentDecision_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatusHistory` (
    `id` VARCHAR(30) NOT NULL,
    `itemId` VARCHAR(30) NOT NULL,
    `fromStatus` VARCHAR(30) NULL,
    `toStatus` VARCHAR(30) NOT NULL,
    `actorUserId` VARCHAR(30) NULL,
    `reason` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StatusHistory_itemId_createdAt_idx`(`itemId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Photo` (
    `id` VARCHAR(30) NOT NULL,
    `itemId` VARCHAR(30) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `customerVisible` BOOLEAN NOT NULL,
    `mime` VARCHAR(30) NOT NULL,
    `content` MEDIUMBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Photo_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `amountIdr` INTEGER NOT NULL,
    `method` VARCHAR(20) NOT NULL,
    `reference` VARCHAR(191) NULL,
    `reason` TEXT NOT NULL,
    `actorUserId` VARCHAR(30) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Payment_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Idempotency` (
    `id` CHAR(64) NOT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `response` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NotificationEvent` ADD CONSTRAINT `NotificationEvent_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Inspection` ADD CONSTRAINT `Inspection_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `OrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsentDecision` ADD CONSTRAINT `ConsentDecision_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `OrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StatusHistory` ADD CONSTRAINT `StatusHistory_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `OrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Photo` ADD CONSTRAINT `Photo_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `OrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

