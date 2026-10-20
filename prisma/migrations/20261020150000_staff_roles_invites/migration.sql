-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('admin', 'moderator');

-- CreateEnum
CREATE TYPE "InvitePurpose" AS ENUM ('staff', 'guestRecovery');

-- AlterTable
ALTER TABLE "GameAdmin" ADD COLUMN     "role" "StaffRole" NOT NULL DEFAULT 'admin';

-- CreateTable
CREATE TABLE "GameInvite" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "purpose" "InvitePurpose" NOT NULL,
    "role" "StaffRole",
    "targetGameUserId" TEXT,
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedById" TEXT,

    CONSTRAINT "GameInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameInvite_tokenHash_key" ON "GameInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "GameInvite_gameId_purpose_idx" ON "GameInvite"("gameId", "purpose");

-- AddForeignKey
ALTER TABLE "GameInvite" ADD CONSTRAINT "GameInvite_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameInvite" ADD CONSTRAINT "GameInvite_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameInvite" ADD CONSTRAINT "GameInvite_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

