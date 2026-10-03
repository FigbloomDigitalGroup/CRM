/**
 * Consumes an async iterable in fixed-size batches, running `handle`
 * concurrently within each batch but never across batches -- bounds how
 * many DB connections an import can hold open at once without going fully
 * serial (FIG-596: "large files handled without timeouts").
 */
export async function processInBatches<T>(
  items: AsyncIterable<T>,
  batchSize: number,
  handle: (item: T) => Promise<void>,
): Promise<void> {
  let batch: T[] = [];
  for await (const item of items) {
    batch.push(item);
    if (batch.length >= batchSize) {
      await Promise.all(batch.map(handle));
      batch = [];
    }
  }
  if (batch.length > 0) {
    await Promise.all(batch.map(handle));
  }
}
