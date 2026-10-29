"use client";

import { useRouter } from "next/navigation";
import { BrandMark } from "@/app/_shared/BrandMark";
import { Button } from "../../components/basics";
import { useApi } from "../../data/hooks";

/**
 * OS1, the suspended-organisation screen (FIG-1166): a person whose organisation Figbloom has paused sees no data, only who to contact and
 * Sign out. The organisation layout renders this instead of the shell, so nobody can navigate into the app. Until the organisation status
 * exists in the API (B6.05) the demo cookie `fb_demo_suspended` stands in for it; Reactivate clears the cookie.
 */
export function SuspendedScreen({ organisation, demo = false }: { organisation: string; demo?: boolean }) {
  const api = useApi();
  const router = useRouter();

  async function signOut() {
    try {
      await api.call("logout", { params: {} });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <main className="fb-susp" data-screen-label="OS1 Suspended organisation">
      <div className="fb-susp__card">
        <BrandMark className="fb-susp__mark" idSuffix="-susp" />
        <span className="fb-susp__tag">V1.1</span>
        <h1 className="fb-susp__title">This workspace is paused</h1>
        <p className="fb-susp__text">
          {organisation}’s Figbloom CRM workspace has been suspended. Your data is safe and nothing has been deleted, but nobody can sign in until it’s reactivated.
        </p>
        <p className="fb-susp__small">If you think this is a mistake, contact your organisation’s Management or Figbloom Support.</p>
        <div className="fb-susp__actions">
          <Button onClick={signOut}>Sign out</Button>
          {demo ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  document.cookie = "fb_demo_suspended=; path=/; max-age=0";
                  window.location.assign("/");
                }}
              >
                Reactivate
              </Button>
              
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
