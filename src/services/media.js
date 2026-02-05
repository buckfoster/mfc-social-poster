async function downloadMedia(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'application/octet-stream';

  return { buffer, contentType };
}

module.exports = { downloadMedia };
