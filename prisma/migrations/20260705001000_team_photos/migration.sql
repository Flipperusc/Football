-- CreateTable
CREATE TABLE "TeamPhoto" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamPhoto_isActive_sortOrder_createdAt_idx" ON "TeamPhoto"("isActive", "sortOrder", "createdAt");
