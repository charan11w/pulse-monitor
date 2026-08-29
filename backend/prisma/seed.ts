import {PrismaClient} from '@prisma/client'

const prisma= new PrismaClient();

async function main(){
  console.log("Starting seed...");

  //removing existing development data
  await prisma.metricAggregate.deleteMany();
  await prisma.telemetryEvent.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  //create user
  const user=await prisma.user.create({
    data:{
      name:"charan",
      email:"charan@example.com",
      passwordHash:"development-password-hash"
    },
  })

   // Create project
  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: "PulseMonitor API",
      description: "Development project for PulseMonitor",
      environment: "development",
    },
  });

  // Create API key
  await prisma.apiKey.create({
    data: {
      projectId: project.id,
      name: "Development Key",
      keyHash: "development-key-hash",
      keyPrefix: "pm_dev",
    },
  });

  // Create telemetry events
  await prisma.telemetryEvent.createMany({
    data: [
      {
        projectId: project.id,
        eventId: "evt_001",
        service: "api",
        route: "/users",
        method: "GET",
        statusCode: 200,
        responseTime: 120,
        environment: "development",
        requestId: "req_001",
        timestamp: new Date(),
      },
      {
        projectId: project.id,
        eventId: "evt_002",
        service: "api",
        route: "/users",
        method: "GET",
        statusCode: 200,
        responseTime: 150,
        environment: "development",
        requestId: "req_002",
        timestamp: new Date(),
      },
      {
        projectId: project.id,
        eventId: "evt_003",
        service: "api",
        route: "/users",
        method: "POST",
        statusCode: 201,
        responseTime: 210,
        environment: "development",
        requestId: "req_003",
        timestamp: new Date(),
      },
      {
        projectId: project.id,
        eventId: "evt_004",
        service: "api",
        route: "/projects",
        method: "GET",
        statusCode: 200,
        responseTime: 95,
        environment: "development",
        requestId: "req_004",
        timestamp: new Date(),
      },
      {
        projectId: project.id,
        eventId: "evt_005",
        service: "api",
        route: "/projects",
        method: "GET",
        statusCode: 500,
        responseTime: 430,
        environment: "development",
        requestId: "req_005",
        timestamp: new Date(),
      },
    ],
  });

  // Create metric aggregate
  await prisma.metricAggregate.create({
    data: {
      projectId: project.id,
      bucketStart: new Date(),
      bucketSize: 60,
      requestCount: 5,
      errorCount: 1,
      averageLatency: 201,
      p95: null,
      p99: null,
    },
  });


  console.log("Seed completed successfully!");

}


main()
  .catch((error) => {
    console.error("Seed failed:", error);
    throw error;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });