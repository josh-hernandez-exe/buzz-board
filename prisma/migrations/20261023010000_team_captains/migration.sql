-- Team captains (optional "captains-only" rule for buzzing and answering).

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "captainsOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GameTeam" ADD COLUMN     "captainId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GameTeam_captainId_key" ON "GameTeam"("captainId");

-- AddForeignKey
ALTER TABLE "GameTeam" ADD CONSTRAINT "GameTeam_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "GameUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing team games: each team's earliest-joined current member captains it.
UPDATE "GameTeam" AS t
SET "captainId" = (
  SELECT u.id FROM "GameUser" AS u
  WHERE u."gameTeamId" = t.id AND u."removedAt" IS NULL
  ORDER BY u.index ASC, u."createdAt" ASC
  LIMIT 1
)
FROM "Game" AS g
WHERE g.id = t."gameId" AND g.format = 'team';
