-- Figbloom sign-in (ERP/CRM_COGNITO_CONTRACT.md): the person's Figbloom account (Cognito customers pool sub).
-- Empty for everyone until Figbloom sign-in is switched on; one Figbloom account belongs to at most one CRM user.
ALTER TABLE "users" ADD COLUMN "identity_sub" TEXT;

CREATE UNIQUE INDEX "users_identity_sub_key" ON "users"("identity_sub");
