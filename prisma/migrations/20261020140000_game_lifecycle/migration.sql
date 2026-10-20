-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('lobby', 'running', 'finished');

-- CreateEnum
CREATE TYPE "TeamAssignment" AS ENUM ('auto', 'choose', 'staff');

-- Existing games keep their current behavior: they are already being played
-- (running) and players pick their own team (choose). The column defaults
-- are switched afterwards so only new games start in the lobby with
-- automatic team assignment.
ALTER TABLE "Game" ADD COLUMN     "creationRequestId" VARCHAR(64),
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "joiningOpen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" "GameStatus" NOT NULL DEFAULT 'running',
ADD COLUMN     "teamAssignment" "TeamAssignment" NOT NULL DEFAULT 'choose';

ALTER TABLE "Game" ALTER COLUMN "status" SET DEFAULT 'lobby',
ALTER COLUMN "teamAssignment" SET DEFAULT 'auto';

-- CreateIndex
CREATE UNIQUE INDEX "Game_createdById_creationRequestId_key" ON "Game"("createdById", "creationRequestId");
