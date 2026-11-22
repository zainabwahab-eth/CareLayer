-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "attemptAt" TIMESTAMP(3),
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Withdrawal_status_attemptAt_idx" ON "Withdrawal"("status", "attemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_one_in_flight_per_nurse" ON "Withdrawal"("nurseId") WHERE (status = ANY (ARRAY['PENDING'::"TxStatus", 'SUBMITTED'::"TxStatus"]));

