-- CreateTable
CREATE TABLE "TeamAnswer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "questionKey" VARCHAR(140) NOT NULL,
    "gameTeamId" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "savedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamAnswer_gameId_questionKey_gameTeamId_key" ON "TeamAnswer"("gameId", "questionKey", "gameTeamId");

-- AddForeignKey
ALTER TABLE "TeamAnswer" ADD CONSTRAINT "TeamAnswer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

