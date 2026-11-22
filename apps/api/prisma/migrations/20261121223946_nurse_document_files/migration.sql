-- CreateTable
CREATE TABLE "NurseDocumentFile" (
    "storageKey" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NurseDocumentFile_pkey" PRIMARY KEY ("storageKey")
);

