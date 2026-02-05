const { BskyAgent, RichText } = require('@atproto/api');

let agent = null;

async function getAgent() {
  if (agent?.session) {
    return agent;
  }

  agent = new BskyAgent({ service: 'https://bsky.social' });
  await agent.login({
    identifier: process.env.BLUESKY_IDENTIFIER,
    password: process.env.BLUESKY_PASSWORD,
  });

  console.log('Bluesky: logged in');
  return agent;
}

async function uploadImage(bskyAgent, buffer, mediaType) {
  const response = await bskyAgent.uploadBlob(buffer, { encoding: mediaType });
  return response.data.blob;
}

async function uploadVideo(bskyAgent, buffer, mediaType) {
  // Get service auth for video upload
  const did = bskyAgent.session.did;

  const serviceAuth = await bskyAgent.com.atproto.server.getServiceAuth({
    aud: `did:web:${encodeURIComponent('video.bsky.app')}`,
    lxm: 'com.atproto.repo.uploadBlob',
    exp: Math.floor(Date.now() / 1000) + 60 * 30, // 30 min
  });

  const token = serviceAuth.data.token;

  // Upload to video service
  const uploadUrl = `https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(did)}&name=video.mp4`;

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mediaType,
    },
    body: buffer,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`Bluesky video upload error ${uploadResponse.status}: ${errText}`);
  }

  const jobStatus = await uploadResponse.json();
  console.log('Bluesky: video upload started', jobStatus.jobId);

  // Poll for completion
  const blob = await pollVideoJob(bskyAgent, jobStatus.jobId);
  return blob;
}

async function pollVideoJob(bskyAgent, jobId) {
  const maxAttempts = 120; // 10 minutes
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusResponse = await fetch(
      `https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`,
      {
        headers: {
          Authorization: `Bearer ${bskyAgent.session.accessJwt}`,
        },
      }
    );

    if (!statusResponse.ok) {
      const errText = await statusResponse.text();
      throw new Error(`Bluesky video status error ${statusResponse.status}: ${errText}`);
    }

    const status = await statusResponse.json();
    const state = status.jobStatus?.state;

    console.log(`Bluesky video status: ${state} (attempt ${attempt + 1})`);

    if (state === 'JOB_STATE_COMPLETED') {
      return status.jobStatus.blob;
    }

    if (state === 'JOB_STATE_FAILED') {
      throw new Error(`Bluesky video processing failed: ${status.jobStatus.error || 'unknown error'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error('Bluesky video processing timed out');
}

async function postToBluesky({ buffer, mediaType, isVideo, caption }) {
  const bskyAgent = await getAgent();

  // Parse rich text (handles mentions, links, hashtags)
  const rt = new RichText({ text: caption });
  await rt.detectFacets(bskyAgent);

  let embed;

  if (isVideo) {
    const blob = await uploadVideo(bskyAgent, buffer, mediaType);
    embed = {
      $type: 'app.bsky.embed.video',
      video: blob,
      aspectRatio: { width: 16, height: 9 },
    };
  } else {
    const blob = await uploadImage(bskyAgent, buffer, mediaType);
    embed = {
      $type: 'app.bsky.embed.images',
      images: [{ alt: caption, image: blob }],
    };
  }

  const post = await bskyAgent.post({
    text: rt.text,
    facets: rt.facets,
    embed,
  });

  console.log(`Bluesky: post created, uri=${post.uri}`);

  return { success: true, uri: post.uri, cid: post.cid };
}

module.exports = { postToBluesky };
