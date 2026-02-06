const express = require('express');
const authMiddleware = require('./middleware/auth');
const { downloadMedia } = require('./services/media');
const { postToTwitter } = require('./services/twitter');
const { postToBluesky } = require('./services/bluesky');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Validate request body for all POST routes
function validateBody(req, res, next) {
  const { mediaUrl, caption } = req.body;

  if (!mediaUrl) {
    return res.status(400).json({ error: 'mediaUrl is required' });
  }

  // Default caption to empty string if null/undefined
  req.body.caption = req.body.caption || '';
  req.body.isVideo = req.body.isVideo || false;
  req.body.mediaType = req.body.mediaType || (req.body.isVideo ? 'video/mp4' : 'image/jpeg');

  next();
}

app.post('/post/twitter', authMiddleware, validateBody, async (req, res) => {
  try {
    const { mediaUrl, caption, isVideo, mediaType } = req.body;
    console.log(`POST /post/twitter: ${mediaUrl} (${isVideo ? 'video' : 'image'})`);

    const { buffer } = await downloadMedia(mediaUrl);
    const result = await postToTwitter({ buffer, mediaType, isVideo, caption });

    res.json({ twitter: result });
  } catch (err) {
    console.error('Twitter post error:', err);
    res.status(500).json({ twitter: { success: false, error: err.message } });
  }
});

app.post('/post/bluesky', authMiddleware, validateBody, async (req, res) => {
  try {
    const { mediaUrl, caption, isVideo, mediaType } = req.body;
    console.log(`POST /post/bluesky: ${mediaUrl} (${isVideo ? 'video' : 'image'})`);

    const { buffer } = await downloadMedia(mediaUrl);
    const result = await postToBluesky({ buffer, mediaType, isVideo, caption });

    res.json({ bluesky: result });
  } catch (err) {
    console.error('Bluesky post error:', err);
    res.status(500).json({ bluesky: { success: false, error: err.message } });
  }
});

app.post('/post/all', authMiddleware, validateBody, async (req, res) => {
  const { mediaUrl, caption, isVideo, mediaType } = req.body;
  console.log(`POST /post/all: ${mediaUrl} (${isVideo ? 'video' : 'image'})`);

  let buffer;
  try {
    ({ buffer } = await downloadMedia(mediaUrl));
  } catch (err) {
    console.error('Media download error:', err);
    return res.status(500).json({
      twitter: { success: false, error: `Media download failed: ${err.message}` },
      bluesky: { success: false, error: `Media download failed: ${err.message}` },
    });
  }

  const [twitterResult, blueskyResult] = await Promise.allSettled([
    postToTwitter({ buffer, mediaType, isVideo, caption }),
    postToBluesky({ buffer, mediaType, isVideo, caption }),
  ]);

  const response = {
    twitter:
      twitterResult.status === 'fulfilled'
        ? twitterResult.value
        : { success: false, error: twitterResult.reason?.message || 'Unknown error' },
    bluesky:
      blueskyResult.status === 'fulfilled'
        ? blueskyResult.value
        : { success: false, error: blueskyResult.reason?.message || 'Unknown error' },
  };

  // Return 207 if partial success, 200 if all good, 500 if all failed
  const anySuccess = response.twitter.success || response.bluesky.success;
  const allSuccess = response.twitter.success && response.bluesky.success;
  const status = allSuccess ? 200 : anySuccess ? 207 : 500;

  res.status(status).json(response);
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`mfc-social-poster listening on port ${PORT}`);
});
