/** Shown (with a 404 status) for every address under /sign/: online signing is V2 and not switched on. Static text only. */
export default function SignNotAvailable() {
  return (
    <main className="sgn__card" aria-labelledby="sgn-na">
      <h1 id="sgn-na">This link is not available</h1>
      <p>Online signing is not switched on. Please contact the person who sent you the quote.</p>
    </main>
  );
}
