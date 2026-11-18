-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "ChatChannel_gameTeamId_idx" ON "ChatChannel"("gameTeamId");

-- CreateIndex
CREATE INDEX "GameAdmin_gameId_idx" ON "GameAdmin"("gameId");

-- CreateIndex
CREATE INDEX "GameUser_gameId_idx" ON "GameUser"("gameId");

-- CreateIndex
CREATE INDEX "GameUser_gameTeamId_idx" ON "GameUser"("gameTeamId");

-- CreateIndex
CREATE INDEX "GameUser_userId_idx" ON "GameUser"("userId");

-- CreateIndex
CREATE INDEX "ScoreboardState_gameId_idx" ON "ScoreboardState"("gameId");

-- CreateIndex
CREATE INDEX "ScoreboardState_scoreboardId_idx" ON "ScoreboardState"("scoreboardId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

