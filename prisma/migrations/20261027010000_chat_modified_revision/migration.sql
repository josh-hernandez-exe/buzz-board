-- Incremental chat fetches: the revision of each channel's last change
-- other than a new message.

-- AlterTable
ALTER TABLE "ChatChannel" ADD COLUMN     "modifiedRevision" INTEGER NOT NULL DEFAULT 0;

-- Existing channels: treat everything so far as modified, so the first
-- fetch after the upgrade is always a full one.
UPDATE "ChatChannel" SET "modifiedRevision" = revision;
