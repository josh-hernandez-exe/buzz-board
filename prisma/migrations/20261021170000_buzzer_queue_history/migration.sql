-- CreateEnum
CREATE TYPE "BuzzerMode" AS ENUM ('first', 'queue');

-- CreateEnum
CREATE TYPE "BuzzQueueStatus" AS ENUM ('waiting', 'answering', 'correct', 'wrong', 'skipped');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "buzzerMode" "BuzzerMode" NOT NULL DEFAULT 'first',
ADD COLUMN     "buzzerWindowHigh" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BuzzQueueEntry" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "window" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "gameTeamId" TEXT NOT NULL,
    "gameUserId" TEXT NOT NULL,
    "status" "BuzzQueueStatus" NOT NULL,
    "requestId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuzzQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuzzerHistory" (
    "gameId" TEXT NOT NULL,
    "past" JSONB NOT NULL DEFAULT '[]',
    "future" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuzzerHistory_pkey" PRIMARY KEY ("gameId")
);

-- CreateIndex
CREATE INDEX "BuzzQueueEntry_gameId_window_idx" ON "BuzzQueueEntry"("gameId", "window");

-- CreateIndex
CREATE UNIQUE INDEX "BuzzQueueEntry_gameId_window_position_key" ON "BuzzQueueEntry"("gameId", "window", "position");

-- CreateIndex
CREATE UNIQUE INDEX "BuzzQueueEntry_gameId_requestId_key" ON "BuzzQueueEntry"("gameId", "requestId");

-- AddForeignKey
ALTER TABLE "BuzzQueueEntry" ADD CONSTRAINT "BuzzQueueEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuzzerHistory" ADD CONSTRAINT "BuzzerHistory_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing games: no window number below the current one is reused.
UPDATE "Game" SET "buzzerWindowHigh" = "buzzerWindow";
