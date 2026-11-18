-- A question is reserved (counted) before the provider is called, then answered or released as ERROR.
ALTER TABLE "assistant_requests" DROP CONSTRAINT IF EXISTS "assistant_requests_status_chk";
ALTER TABLE "assistant_requests" ADD CONSTRAINT "assistant_requests_status_chk" CHECK ("status" IN ('RESERVED', 'ANSWERED', 'ERROR'));
