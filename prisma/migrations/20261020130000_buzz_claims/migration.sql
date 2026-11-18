-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "buzzerWindow" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BuzzClaim" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "window" INTEGER NOT NULL,
    "gameUserId" TEXT NOT NULL,
    "gameTeamId" TEXT NOT NULL,
    "requestId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuzzClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuzzClaim_gameId_window_key" ON "BuzzClaim"("gameId", "window");

-- CreateIndex
CREATE UNIQUE INDEX "BuzzClaim_gameId_requestId_key" ON "BuzzClaim"("gameId", "requestId");

-- AddForeignKey
ALTER TABLE "BuzzClaim" ADD CONSTRAINT "BuzzClaim_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

