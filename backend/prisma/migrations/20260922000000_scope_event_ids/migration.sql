-- Add project-scoped uniqueness before removing the stronger global constraint.
-- Existing rows remain valid; no data is deleted.
CREATE UNIQUE INDEX "TelemetryEvent_projectId_eventId_key"
ON "TelemetryEvent"("projectId", "eventId");

DROP INDEX "TelemetryEvent_eventId_key";
