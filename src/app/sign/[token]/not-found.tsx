/** Shown (with a 404 status) for every address under /sign/: online signing is V2 and not switched on. Static text only. */
export default function SignNotAvailable() {
  return (
    <main className="sgn__wrap">
      <div className="sgn__bar">
        <span className="sgn__brand">FigBloom Digital Group</span>
      </div>
      <section className="sgn__card" aria-labelledby="sgn-na">
        <h1 className="sgn__h1" id="sgn-na">
          This link is not available
        </h1>
        <p className="sgn__muted">Online signing is not switched on. Please contact the person who sent you the quote.</p>
      </section>
    </main>
  );
}
