-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('WOMAN', 'NURSE', 'ADMIN');

-- CreateEnum
CREATE TYPE "NurseRole" AS ENUM ('NURSE', 'MIDWIFE');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ENGLISH', 'PIDGIN', 'YORUBA', 'HAUSA', 'IGBO');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NurseDocumentType" AS ENUM ('PRACTISING_LICENCE', 'REGISTRATION_CERTIFICATE', 'GOVERNMENT_ID', 'SELFIE_WITH_ID');

-- CreateEnum
CREATE TYPE "CodePurpose" AS ENUM ('SIGNUP', 'LOGIN', 'STEP_UP');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('OPEN', 'CLAIMED', 'ANSWERED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NurseSelection" AS ENUM ('FIRST_AVAILABLE', 'CHOSEN_NURSE');

-- CreateEnum
CREATE TYPE "QuestionSource" AS ENUM ('WEB', 'MCP', 'AGENT');

-- CreateEnum
CREATE TYPE "AgeRange" AS ENUM ('UNDER_18', 'AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_PLUS');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'ANSWERED');

-- CreateEnum
CREATE TYPE "SharedField" AS ENUM ('CLEANED_TEXT', 'ORIGINAL_TEXT', 'ASSISTANT_NOTES', 'CATEGORY', 'AGE_RANGE', 'PREGNANCY_WEEKS');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('WOMAN_WALLET', 'TREASURY_FREE', 'EXTERNAL_AGENT');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "Appearance" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "QuickExitTarget" AS ENUM ('GOOGLE', 'WEATHER', 'NEWS');

-- CreateEnum
CREATE TYPE "EmergencySource" AS ENUM ('CHAT', 'QUESTION', 'MCP');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "googleSub" TEXT,
    "freeAnswersUsed" INTEGER NOT NULL DEFAULT 0,
    "termsAcceptedAt" TIMESTAMP(3),
    "termsVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "stepUpAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "purpose" "CodePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AgentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "appearance" "Appearance" NOT NULL DEFAULT 'SYSTEM',
    "quickExitTarget" "QuickExitTarget" NOT NULL DEFAULT 'GOOGLE',
    "spendingLimitPerAnswerKobo" INTEGER NOT NULL DEFAULT 100000,
    "mcpSpendingLimitPerAnswerKobo" INTEGER NOT NULL DEFAULT 50000,
    "mcpAskBeforeEachPayment" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "notifyWhenAnswered" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stellarPublicKey" TEXT NOT NULL,
    "encryptedSecret" BYTEA NOT NULL,
    "cachedBalanceStroops" BIGINT NOT NULL DEFAULT 0,
    "balanceSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NurseProfile" (
    "userId" TEXT NOT NULL,
    "role" "NurseRole",
    "fullName" TEXT NOT NULL,
    "fullNameConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "gender" "Gender",
    "practiceArea" TEXT,
    "yearsOfPractice" INTEGER,
    "bio" VARCHAR(280),
    "languages" "Language"[],
    "licenceNumber" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "ownStellarAddress" TEXT,
    "guidanceAcceptedAt" TIMESTAMP(3),
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "avgResponseSeconds" INTEGER,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NurseProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "NurseDocument" (
    "id" TEXT NOT NULL,
    "nurseId" TEXT NOT NULL,
    "type" "NurseDocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NurseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "NurseTopic" (
    "nurseId" TEXT NOT NULL,
    "topicSlug" TEXT NOT NULL,

    CONSTRAINT "NurseTopic_pkey" PRIMARY KEY ("nurseId","topicSlug")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "womanId" TEXT,
    "source" "QuestionSource" NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'OPEN',
    "originalText" TEXT NOT NULL,
    "cleanedText" TEXT NOT NULL,
    "assistantNotes" TEXT,
    "topicSlug" TEXT NOT NULL,
    "ageRange" "AgeRange",
    "pregnancyWeeks" INTEGER,
    "femaleOnly" BOOLEAN NOT NULL DEFAULT false,
    "selection" "NurseSelection" NOT NULL DEFAULT 'FIRST_AVAILABLE',
    "chosenNurseId" TEXT,
    "chosenUntil" TIMESTAMP(3),
    "fellBackAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "priceKobo" INTEGER NOT NULL,
    "priceStroops" BIGINT NOT NULL,
    "isFree" BOOLEAN NOT NULL,
    "questionKeyHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "sharedFields" "SharedField"[],
    "consentVersion" TEXT NOT NULL,
    "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "nurseId" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'ACTIVE',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "nurseId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "recommendSeeSomeoneToday" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "womanId" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "payerAddress" TEXT,
    "amountKobo" INTEGER NOT NULL,
    "amountStroops" BIGINT NOT NULL,
    "platformFeeStroops" BIGINT NOT NULL,
    "status" "TxStatus" NOT NULL,
    "stellarTxHash" TEXT,
    "x402Reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "nurseId" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "amountStroops" BIGINT NOT NULL,
    "fromTreasury" BOOLEAN NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "status" "TxStatus" NOT NULL,
    "stellarTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topup" (
    "id" TEXT NOT NULL,
    "womanId" TEXT NOT NULL,
    "paystackReference" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "amountStroops" BIGINT NOT NULL,
    "status" "TxStatus" NOT NULL,
    "stellarTxHash" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creditedAt" TIMESTAMP(3),

    CONSTRAINT "Topup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "nurseId" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "amountStroops" BIGINT NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "status" "TxStatus" NOT NULL,
    "stellarTxHash" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyEvent" (
    "id" TEXT NOT NULL,
    "source" "EmergencySource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_role_key" ON "User"("email", "role");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_role_key" ON "User"("googleSub", "role");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- CreateIndex
CREATE INDEX "EmailCode_email_role_purpose_createdAt_idx" ON "EmailCode"("email", "role", "purpose", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AgentToken_tokenHash_key" ON "AgentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentToken_userId_idx" ON "AgentToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_stellarPublicKey_key" ON "Wallet"("stellarPublicKey");

-- CreateIndex
CREATE UNIQUE INDEX "NurseProfile_licenceNumber_key" ON "NurseProfile"("licenceNumber");

-- CreateIndex
CREATE INDEX "NurseProfile_verificationStatus_submittedAt_idx" ON "NurseProfile"("verificationStatus", "submittedAt");

-- CreateIndex
CREATE INDEX "NurseProfile_verificationStatus_available_gender_idx" ON "NurseProfile"("verificationStatus", "available", "gender");

-- CreateIndex
CREATE UNIQUE INDEX "NurseDocument_storageKey_key" ON "NurseDocument"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "NurseDocument_nurseId_type_key" ON "NurseDocument"("nurseId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_sortOrder_key" ON "Topic"("sortOrder");

-- CreateIndex
CREATE INDEX "NurseTopic_topicSlug_idx" ON "NurseTopic"("topicSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Question_questionKeyHash_key" ON "Question"("questionKeyHash");

-- CreateIndex
CREATE INDEX "Question_status_topicSlug_createdAt_idx" ON "Question"("status", "topicSlug", "createdAt");

-- CreateIndex
CREATE INDEX "Question_status_expiresAt_idx" ON "Question"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Question_status_chosenUntil_idx" ON "Question"("status", "chosenUntil");

-- CreateIndex
CREATE INDEX "Question_chosenNurseId_status_idx" ON "Question"("chosenNurseId", "status");

-- CreateIndex
CREATE INDEX "Question_womanId_createdAt_idx" ON "Question"("womanId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Consent_questionId_key" ON "Consent"("questionId");

-- CreateIndex
CREATE INDEX "Claim_nurseId_status_idx" ON "Claim"("nurseId", "status");

-- CreateIndex
CREATE INDEX "Claim_status_expiresAt_idx" ON "Claim"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Claim_questionId_idx" ON "Claim"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_one_active_per_nurse" ON "Claim"("nurseId") WHERE ("status" = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "Claim_one_active_per_question" ON "Claim"("questionId") WHERE ("status" = 'ACTIVE');

-- CreateIndex
CREATE UNIQUE INDEX "Answer_questionId_key" ON "Answer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_claimId_key" ON "Answer"("claimId");

-- CreateIndex
CREATE INDEX "Answer_nurseId_createdAt_idx" ON "Answer"("nurseId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_answerId_key" ON "Feedback"("answerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_questionId_key" ON "Payment"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stellarTxHash_key" ON "Payment"("stellarTxHash");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_paymentId_key" ON "Payout"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_stellarTxHash_key" ON "Payout"("stellarTxHash");

-- CreateIndex
CREATE INDEX "Payout_nurseId_createdAt_idx" ON "Payout"("nurseId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Topup_paystackReference_key" ON "Topup"("paystackReference");

-- CreateIndex
CREATE UNIQUE INDEX "Topup_stellarTxHash_key" ON "Topup"("stellarTxHash");

-- CreateIndex
CREATE INDEX "Topup_womanId_createdAt_idx" ON "Topup"("womanId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_stellarTxHash_key" ON "Withdrawal"("stellarTxHash");

-- CreateIndex
CREATE INDEX "Withdrawal_nurseId_createdAt_idx" ON "Withdrawal"("nurseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EmergencyEvent_createdAt_idx" ON "EmergencyEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToken" ADD CONSTRAINT "AgentToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NurseProfile" ADD CONSTRAINT "NurseProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NurseProfile" ADD CONSTRAINT "NurseProfile_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NurseDocument" ADD CONSTRAINT "NurseDocument_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "NurseProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NurseTopic" ADD CONSTRAINT "NurseTopic_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "NurseProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NurseTopic" ADD CONSTRAINT "NurseTopic_topicSlug_fkey" FOREIGN KEY ("topicSlug") REFERENCES "Topic"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_womanId_fkey" FOREIGN KEY ("womanId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicSlug_fkey" FOREIGN KEY ("topicSlug") REFERENCES "Topic"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_chosenNurseId_fkey" FOREIGN KEY ("chosenNurseId") REFERENCES "NurseProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "NurseProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "NurseProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_womanId_fkey" FOREIGN KEY ("womanId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "NurseProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topup" ADD CONSTRAINT "Topup_womanId_fkey" FOREIGN KEY ("womanId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "NurseProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
