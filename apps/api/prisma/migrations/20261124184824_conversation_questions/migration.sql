-- CreateTable
CREATE TABLE "ConversationQuestion" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationQuestion_questionId_key" ON "ConversationQuestion"("questionId");

-- CreateIndex
CREATE INDEX "ConversationQuestion_conversationId_createdAt_idx" ON "ConversationQuestion"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversationQuestion" ADD CONSTRAINT "ConversationQuestion_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationQuestion" ADD CONSTRAINT "ConversationQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
