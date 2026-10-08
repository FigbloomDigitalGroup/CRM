import { BrandMark } from "@/app/_shared/BrandMark";

/**
 * Left-hand brand panel of the /login screen: animated hero (floating glass
 * cards around the Figbloom CRM mark), headline and feature row.
 *
 * Purely presentational and static -- the figures on the cards are sample
 * data for illustration, and nothing here reads from the app. All motion is
 * CSS/SMIL and is switched off for `prefers-reduced-motion` (see globals.css,
 * "Login screen").
 */
export function LoginHero() {
  return (
    <section className="lg-hero" aria-label="Figbloom CRM">
      <div className="lg-canvas">
        <div className="lg-lock">
          <div className="lg-logochip">
            <BrandMark className="lg-mark-sm" idSuffix="-chip" />
          </div>
          <b>
            Figbloom<span>CRM</span>
          </b>
        </div>

        <div className="lg-stage" aria-hidden="true">
          <div className="lg-glow" />
          <svg className="lg-orbits" viewBox="0 0 740 450" width="740" height="450">
            <g className="lg-ring-o">
              <ellipse cx="370" cy="215" rx="250" ry="180" fill="none" stroke="rgba(255,255,255,.16)" strokeDasharray="3 9" strokeWidth="1.6" />
              <circle cx="620" cy="215" r="6" fill="#ff9400" />
              <circle cx="120" cy="215" r="4" fill="#fff" opacity=".8" />
            </g>
            <g className="lg-ring-o2">
              <ellipse cx="370" cy="215" rx="190" ry="140" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1.2" />
              <circle cx="370" cy="75" r="5" fill="#7be08a" />
              <circle cx="370" cy="355" r="3.5" fill="#ff9400" opacity=".9" />
            </g>
            <path id="lg-p1" d="M242 115 C 285 118, 318 140, 344 168" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" strokeDasharray="4 6" />
            <path id="lg-p2" d="M488 100 C 450 120, 420 150, 400 175" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" strokeDasharray="4 6" />
            <path id="lg-p3" d="M272 335 C 310 320, 330 290, 345 262" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" strokeDasharray="4 6" />
            <path id="lg-p4" d="M470 330 C 440 310, 415 285, 400 262" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" strokeDasharray="4 6" />
            <g className="lg-travellers">
              <circle r="4.5" fill="#ff9400">
                <animateMotion dur="3.2s" repeatCount="indefinite">
                  <mpath href="#lg-p1" />
                </animateMotion>
              </circle>
              <circle r="4.5" fill="#fff">
                <animateMotion dur="3.8s" begin="-1s" repeatCount="indefinite">
                  <mpath href="#lg-p2" />
                </animateMotion>
              </circle>
              <circle r="4.5" fill="#7be08a">
                <animateMotion dur="3.5s" begin="-2s" repeatCount="indefinite">
                  <mpath href="#lg-p3" />
                </animateMotion>
              </circle>
              <circle r="4.5" fill="#ff9400">
                <animateMotion dur="4s" begin="-0.5s" repeatCount="indefinite">
                  <mpath href="#lg-p4" />
                </animateMotion>
              </circle>
            </g>
          </svg>
          <div className="lg-bigmark">
            <BrandMark className="lg-mark-lg" idSuffix="-hero" />
          </div>

          <div className="lg-card lg-c1">
            <div className="lg-row">
              <div className="lg-av">AO</div>
              <div>
                <div className="lg-t">Amara Osei</div>
                <div className="lg-s">New lead &middot; Website</div>
              </div>
              <div className="lg-tag">NEW</div>
            </div>
          </div>

          <div className="lg-card lg-c2">
            <div className="lg-lab">Deal pipeline</div>
            <div className="lg-big">KES 480,000</div>
            <div className="lg-stages">
              <i className="on" />
              <i className="on" />
              <i className="run" />
              <i />
            </div>
            <div className="lg-stl">
              <span>Qualified</span>
              <span>Proposal</span>
              <span>Won</span>
            </div>
          </div>

          <div className="lg-card lg-c3">
            <div className="lg-row">
              <div className="lg-chk">
                <svg viewBox="0 0 24 24">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </div>
              <div>
                <div className="lg-t">Follow up with Zuri Ltd</div>
                <div className="lg-s">Task &middot; due today, 3:00 PM</div>
              </div>
            </div>
          </div>

          <div className="lg-card lg-c4">
            <div className="lg-smp">SAMPLE DATA</div>
            <div className="lg-lab">Deals won</div>
            <div className="lg-row" style={{ marginTop: 2 }}>
              <div className="lg-big" style={{ marginTop: 0 }}>18</div>
              <span className="lg-up">&#9650; 24%</span>
            </div>
            <svg className="lg-spark" width="228" height="46" viewBox="0 0 228 46">
              <defs>
                <linearGradient id="lg-sg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ff9400" stopOpacity=".45" />
                  <stop offset="1" stopColor="#ff9400" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M2 38 C 28 36, 38 22, 62 26 S 100 40, 124 22 S 170 10, 190 14 S 216 6, 226 4 L226 46 L2 46Z" fill="url(#lg-sg)" />
              <path className="lg-line" d="M2 38 C 28 36, 38 22, 62 26 S 100 40, 124 22 S 170 10, 190 14 S 216 6, 226 4" fill="none" stroke="#ff9400" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <div className="lg-copy">
          <h1>
            Every relationship,
            <span className="lg-l2">in full bloom.</span>
          </h1>
          <p>
            Track leads, grow deals and never miss a follow-up &mdash; your whole customer
            pipeline in one calm, connected workspace.
          </p>
          <div className="lg-feat">
            <div>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Leads &amp; contacts
            </div>
            <div>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
              Deals pipeline
            </div>
            <div>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 11 3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              Tasks &amp; reports
            </div>
          </div>
        </div>

        <div className="lg-foot">&copy; 2026 Figbloom CRM &middot; Figbloom Digital Group</div>
      </div>
    </section>
  );
}
