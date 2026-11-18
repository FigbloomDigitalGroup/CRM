-- FIG-1038 (B2.09): the requirements a task carries.
--
-- Restricted Technical users work from tasks. There is no project model, so
-- the client requirements ride on the task as a snapshot written when it is
-- created (for example from the handoff scope). Later changes to the deal or
-- the handoff do not rewrite it, and it is all a technician sees of the work.

ALTER TABLE "tasks" ADD COLUMN "requirements" TEXT;
