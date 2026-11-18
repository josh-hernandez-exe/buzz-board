-- CreateTable
CREATE TABLE "GameOperation" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "requestId" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "actorUserId" TEXT,
    "payloadHash" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreEffect" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "gameTeamId" TEXT NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "scoreBefore" DOUBLE PRECISION NOT NULL,
    "scoreAfter" DOUBLE PRECISION NOT NULL,
    "scoreboardStateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreEffect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameOperation_gameId_createdAt_idx" ON "GameOperation"("gameId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameOperation_gameId_requestId_key" ON "GameOperation"("gameId", "requestId");

-- CreateIndex
CREATE INDEX "ScoreEffect_gameId_gameTeamId_createdAt_idx" ON "ScoreEffect"("gameId", "gameTeamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreEffect_operationId_gameTeamId_key" ON "ScoreEffect"("operationId", "gameTeamId");

-- AddForeignKey
ALTER TABLE "GameOperation" ADD CONSTRAINT "GameOperation_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameOperation" ADD CONSTRAINT "GameOperation_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEffect" ADD CONSTRAINT "ScoreEffect_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEffect" ADD CONSTRAINT "ScoreEffect_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "GameOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

