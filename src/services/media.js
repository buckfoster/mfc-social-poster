async function downloadMedia(url) {
  // URL validation
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }
  const hostname = parsed.hostname;
  if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') || hostname.startsWith('172.') || hostname === '0.0.0.0') {
    throw new Error('Private/local URLs are not allowed');
  }

  // Timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
    }

    // Size check
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > 500 * 1024 * 1024) {
      throw new Error(`File too large: ${contentLength} bytes`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 500 * 1024 * 1024) {
      throw new Error(`Downloaded file too large: ${buffer.length} bytes`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    return { buffer, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { downloadMedia };
