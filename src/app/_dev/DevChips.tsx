/**
 * The dev sign-in chips (F1.07): one tap to sign in as any seeded account, mounted from the root layout, outside the frozen sign-in pages, so
 * those pages' markup and styles are untouched.
 *
 * They exist only in development with dev accounts allowed (`devAccountsAllowed`, CLAUDE.md rule 10) and only when the seeded organisation is present.
 * In a production build the module that draws them is not part of the bundle at all: the dynamic import sits in a branch that
 * `process.env.NODE_ENV === "production"` removes at build time, and `tests/devChipsBuild.test.ts` greps the build output to prove it.
 */
export async function DevChips() {
  const render = process.env.NODE_ENV === "production" ? null : (await import("./renderDevChips")).renderDevChips;
  return render ? render() : null;
}
