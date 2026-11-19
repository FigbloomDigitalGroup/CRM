import { FigbloomNotice } from "../FigbloomNotice";

/** Where Figbloom's sign-in page sends the browser after signing out of CRM. */
export default function FigbloomSignedOut() {
  return (
    <FigbloomNotice title="You're signed out" action={{ href: "/login", label: "Sign in again" }}>
      You have signed out of Figbloom CRM.
    </FigbloomNotice>
  );
}
