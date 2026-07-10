-- CreateTable
CREATE TABLE "TeamSetting" (
    "id" TEXT NOT NULL,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSetting_pkey" PRIMARY KEY ("id")
);
