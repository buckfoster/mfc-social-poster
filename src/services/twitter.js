const crypto = require('crypto');
const OAuth = require('oauth-1.0a');

const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
const TWEET_URL = 'https://api.twitter.com/2/tweets';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

function createOAuth() {
  return OAuth({
    consumer: {
      key: process.env.TWITTER_API_KEY,
      secret: process.env.TWITTER_API_SECRET,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });
}

function getToken() {
  return {
    key: process.env.TWITTER_ACCESS_TOKEN,
    secret: process.env.TWITTER_ACCESS_SECRET,
  };
}

async function oauthFetch(url, method, body, contentType) {
  const oauth = createOAuth();
  const token = getToken();

  const requestData = { url, method };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const headers = { ...authHeader };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Twitter API error ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function uploadImage(buffer, mediaType) {
  const oauth = createOAuth();
  const token = getToken();

  const requestData = { url: UPLOAD_URL, method: 'POST' };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const formData = new FormData();
  formData.append('media_data', buffer.toString('base64'));
  formData.append('media_category', 'tweet_image');

  const response = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { ...authHeader },
    body: formData,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Twitter image upload error ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

async function chunkedUpload(buffer, mediaType) {
  const totalBytes = buffer.length;

  // INIT
  const oauth = createOAuth();
  const token = getToken();

  const initParams = new URLSearchParams({
    command: 'INIT',
    total_bytes: totalBytes.toString(),
    media_type: mediaType,
    media_category: 'tweet_video',
  });

  const initUrl = `${UPLOAD_URL}?${initParams}`;
  const initRequestData = { url: initUrl, method: 'POST' };
  const initAuth = oauth.toHeader(oauth.authorize(initRequestData, token));

  const initResponse = await fetch(initUrl, {
    method: 'POST',
    headers: { ...initAuth },
  });

  const initText = await initResponse.text();
  if (!initResponse.ok) {
    throw new Error(`Twitter INIT error ${initResponse.status}: ${initText}`);
  }

  const { media_id_string: mediaId } = JSON.parse(initText);
  console.log(`Twitter INIT: media_id=${mediaId}, total_bytes=${totalBytes}`);

  // APPEND - upload in chunks
  const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalBytes);
    const chunk = buffer.subarray(start, end);

    const appendOAuth = createOAuth();
    const appendParams = new URLSearchParams({
      command: 'APPEND',
      media_id: mediaId,
      segment_index: i.toString(),
    });
    const appendUrl = `${UPLOAD_URL}?${appendParams}`;
    const appendRequestData = { url: appendUrl, method: 'POST' };
    const appendAuth = appendOAuth.toHeader(appendOAuth.authorize(appendRequestData, token));

    const formData = new FormData();
    formData.append('media', new Blob([chunk]), 'chunk');

    const appendResponse = await fetch(appendUrl, {
      method: 'POST',
      headers: { ...appendAuth },
      body: formData,
    });

    if (!appendResponse.ok) {
      const errText = await appendResponse.text();
      throw new Error(`Twitter APPEND error (chunk ${i}/${totalChunks}): ${appendResponse.status}: ${errText}`);
    }

    console.log(`Twitter APPEND: chunk ${i + 1}/${totalChunks}`);
  }

  // FINALIZE
  const finalizeOAuth = createOAuth();
  const finalizeParams = new URLSearchParams({
    command: 'FINALIZE',
    media_id: mediaId,
  });
  const finalizeUrl = `${UPLOAD_URL}?${finalizeParams}`;
  const finalizeRequestData = { url: finalizeUrl, method: 'POST' };
  const finalizeAuth = finalizeOAuth.toHeader(finalizeOAuth.authorize(finalizeRequestData, token));

  const finalizeResponse = await fetch(finalizeUrl, {
    method: 'POST',
    headers: { ...finalizeAuth },
  });

  const finalizeText = await finalizeResponse.text();
  if (!finalizeResponse.ok) {
    throw new Error(`Twitter FINALIZE error ${finalizeResponse.status}: ${finalizeText}`);
  }

  const finalizeData = JSON.parse(finalizeText);
  console.log('Twitter FINALIZE:', JSON.stringify(finalizeData));

  // STATUS polling if needed
  if (finalizeData.processing_info) {
    await pollProcessingStatus(mediaId);
  }

  return mediaId;
}

async function pollProcessingStatus(mediaId) {
  const maxAttempts = 60; // 5 minutes max
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const oauth = createOAuth();
    const token = getToken();

    const statusParams = new URLSearchParams({
      command: 'STATUS',
      media_id: mediaId,
    });
    const statusUrl = `${UPLOAD_URL}?${statusParams}`;
    const statusRequestData = { url: statusUrl, method: 'GET' };
    const statusAuth = oauth.toHeader(oauth.authorize(statusRequestData, token));

    const statusResponse = await fetch(statusUrl, {
      method: 'GET',
      headers: { ...statusAuth },
    });

    const statusText = await statusResponse.text();
    if (!statusResponse.ok) {
      throw new Error(`Twitter STATUS error ${statusResponse.status}: ${statusText}`);
    }

    const statusData = JSON.parse(statusText);
    const state = statusData.processing_info?.state;

    console.log(`Twitter STATUS: ${state} (attempt ${attempt + 1})`);

    if (state === 'succeeded') {
      return;
    }

    if (state === 'failed') {
      throw new Error(`Twitter video processing failed: ${JSON.stringify(statusData.processing_info)}`);
    }

    const waitSeconds = statusData.processing_info?.check_after_secs || 5;
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }

  throw new Error('Twitter video processing timed out');
}

async function createTweet(text, mediaId) {
  const body = { text };
  if (mediaId) {
    body.media = { media_ids: [mediaId] };
  }

  const result = await oauthFetch(TWEET_URL, 'POST', JSON.stringify(body), 'application/json');
  return result;
}

async function postToTwitter({ buffer, mediaType, isVideo, caption }) {
  let mediaId;

  if (isVideo) {
    mediaId = await chunkedUpload(buffer, mediaType);
  } else {
    const uploadResult = await uploadImage(buffer, mediaType);
    mediaId = uploadResult.media_id_string;
  }

  console.log(`Twitter: media uploaded, id=${mediaId}`);

  const tweet = await createTweet(caption, mediaId);
  const tweetId = tweet.data?.id;

  console.log(`Twitter: tweet created, id=${tweetId}`);

  return { success: true, id: tweetId };
}

module.exports = { postToTwitter };
