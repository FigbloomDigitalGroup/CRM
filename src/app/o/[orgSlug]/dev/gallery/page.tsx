import { notFound } from "next/navigation";
import { devAccountsAllowed } from "@/auth/devAccounts";
import { Gallery } from "@/ui/Gallery";

/**
 * The component gallery (F1.02). Development only: it renders under `next dev` with dev accounts allowed, or on a server started for the end-to-end
 * suite with `E2E_UI_GALLERY=true`. Anywhere else (every real deployment) it is a 404, like the dev sign-in routes.
 */
export default function GalleryPage() {
  if (!devAccountsAllowed() && process.env.E2E_UI_GALLERY !== "true") notFound();
  return (
    <div className="fb-page-list">
      <h1 style={{ margin: 0 }}>Component gallery</h1>
      <p style={{ margin: 0, color: "var(--text-2)" }}>Every component, every state. Use the controls to see it in dark, compact, largest text and at 375px.</p>
      <Gallery />
    </div>
  );
}
