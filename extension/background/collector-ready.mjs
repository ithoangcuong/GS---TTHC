// Retry only loading/empty snapshots; never retry parsing or authentication errors.
export async function collectWhenReady(read, checkContext, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let result;
  for (let attempt = 0; attempt < 6; attempt++) {
    await checkContext();
    result = await read();
    await checkContext();
    const empty = result?.ok && result.total === 0 && Array.isArray(result.records)
      && result.records.length === 0 && Array.isArray(result.errors) && result.errors.length === 0;
    if (!empty && result?.code !== 'COLLECTOR_LOADING') return result;
    if (attempt < 5) await wait(1000);
  }
  return result;
}
