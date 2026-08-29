-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "environment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTime" DOUBLE PRECISION NOT NULL,
    "environment" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "traceId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricAggregate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "bucketSize" INTEGER NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "averageLatency" DOUBLE PRECISION NOT NULL,
    "p95" DOUBLE PRECISION,
    "p99" DOUBLE PRECISION,

    CONSTRAINT "MetricAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TelemetryEvent_eventId_key" ON "TelemetryEvent"("eventId");

-- CreateIndex
CREATE INDEX "TelemetryEvent_projectId_idx" ON "TelemetryEvent"("projectId");

-- CreateIndex
CREATE INDEX "TelemetryEvent_timestamp_idx" ON "TelemetryEvent"("timestamp");

-- CreateIndex
CREATE INDEX "TelemetryEvent_projectId_timestamp_idx" ON "TelemetryEvent"("projectId", "timestamp");

-- CreateIndex
CREATE INDEX "TelemetryEvent_projectId_route_idx" ON "TelemetryEvent"("projectId", "route");

-- CreateIndex
CREATE INDEX "TelemetryEvent_projectId_service_idx" ON "TelemetryEvent"("projectId", "service");

-- CreateIndex
CREATE INDEX "MetricAggregate_projectId_bucketStart_idx" ON "MetricAggregate"("projectId", "bucketStart");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryEvent" ADD CONSTRAINT "TelemetryEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricAggregate" ADD CONSTRAINT "MetricAggregate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
