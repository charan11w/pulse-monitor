CREATE INDEX "Project_userId_createdAt_id_idx" ON "Project"("userId", "createdAt", "id");
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_projectId_createdAt_id_idx" ON "ApiKey"("projectId", "createdAt", "id");
