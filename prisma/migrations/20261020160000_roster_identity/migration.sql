-- AlterTable
ALTER TABLE "GameTeam" ADD COLUMN     "allowMemberRename" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nameVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GameUser" ADD COLUMN     "allowSelfRename" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nameVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "removedAt" TIMESTAMP(3);

