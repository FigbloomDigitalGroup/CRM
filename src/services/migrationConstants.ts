/**
 * The data migration job type, on its own so the job catalogue can read it while it loads. `migrationService` imports the job runner
 * and the catalogue imports `migrationService`, a loop; a constant that lives in either file is not there yet when the other needs it.
 */
export const MIGRATION_JOB = "data.migration";
