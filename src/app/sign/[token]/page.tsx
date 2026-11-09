/**
 * Public quote signing (FIG-1193) is V2 and is not part of the first release: no signing link is issued, so every address under /sign/ gets the same
 * plain "not available" page. It reads nothing, names no organisation and carries no sample data. The signing screen returns with V2.
 */
export default function SignPage() {
  return (
    <main className="sgn__card" aria-labelledby="sgn-na">
      <h1 id="sgn-na">This link is not available</h1>
      <p>Online signing is not switched on. Please contact the person who sent you the quote.</p>
    </main>
  );
}
