/**
 * The Social screens run on demo data (`./demo/`), so they exist only where `DEMO_SCREENS=true` (`npm run preview` sets it). Production and CI builds
 * return 404 for the route and draw no sidebar link. Remove this gate when the screens are wired to the connector API (S2, S3).
 */
export const socialScreensEnabled = (): boolean => process.env.DEMO_SCREENS === "true";
