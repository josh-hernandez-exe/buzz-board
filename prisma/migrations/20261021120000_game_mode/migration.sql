-- CreateTable
CREATE TABLE "GameMode" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "draft" JSONB NOT NULL,
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    "content" JSONB,
    "state" JSONB,
    "history" JSONB NOT NULL DEFAULT '[]',
    "step" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameMode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameMode_gameId_key" ON "GameMode"("gameId");

-- AddForeignKey
ALTER TABLE "GameMode" ADD CONSTRAINT "GameMode_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

