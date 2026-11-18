-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "chatEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "gameTeamId" TEXT,
    "staffOnly" BOOLEAN NOT NULL DEFAULT false,
    "slowModeSeconds" INTEGER NOT NULL DEFAULT 0,
    "pinnedMessageId" TEXT,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "clearedThroughSequence" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actorKey" VARCHAR(64) NOT NULL,
    "requestId" VARCHAR(64) NOT NULL,
    "bodyHash" VARCHAR(64) NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "expiredAt" TIMESTAMP(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMute" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "actorKey" VARCHAR(64) NOT NULL,
    "until" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_gameId_key_key" ON "ChatChannel"("gameId", "key");

-- CreateIndex
CREATE INDEX "ChatMessage_gameId_createdAt_idx" ON "ChatMessage"("gameId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_channelId_sequence_key" ON "ChatMessage"("channelId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_gameId_actorKey_requestId_key" ON "ChatMessage"("gameId", "actorKey", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMute_gameId_actorKey_key" ON "ChatMute"("gameId", "actorKey");

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_gameTeamId_fkey" FOREIGN KEY ("gameTeamId") REFERENCES "GameTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMute" ADD CONSTRAINT "ChatMute_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

