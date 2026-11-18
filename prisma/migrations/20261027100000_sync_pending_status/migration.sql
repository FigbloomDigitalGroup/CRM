-- B4.07: a sync mutation is claimed (PENDING) before it runs, so two requests carrying the same client id can never both apply it.
ALTER TABLE "sync_mutations" DROP CONSTRAINT "sync_mutations_status_chk";
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_status_chk" CHECK ("status" IN ('PENDING', 'APPLIED', 'CONFLICT', 'REJECTED'));
