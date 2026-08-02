/**
 * REFERENCE SERVICE FIXTURE (E09-T3, acceptance criterion 1): a well-behaved
 * `runtime: node20` add-on. It uses NOTHING but the public API and the four
 * environment variables the Core hands it:
 *
 *   1. POST {API}/api/v1/addons/{id}/events   -> publishes `addon/{id}/started`
 *   2. WS   {API}/ws/v1?token=...             -> subscribes to `pos/update`
 *      (needs the `pos.read` scope) and republishes each fix as
 *      `addon/{id}/pos-seen`.
 *
 * No internal imports, no SQLite, no privileged channel (docs/05 §1B).
 */

const API = process.env.YAPAJA_API_URL;
const TOKEN = process.env.YAPAJA_TOKEN;
const ID = process.env.YAPAJA_ADDON_ID;

async function publish(topic, payload) {
  try {
    await fetch(`${API}/api/v1/addons/${ID}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ topic, payload }),
    });
  } catch (err) {
    console.error('publish failed', String(err));
  }
}

const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/v1?token=${encodeURIComponent(TOKEN)}`);

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'subscribe', topics: ['pos/update'] }));
  void publish('started', { pid: process.pid });
});

socket.addEventListener('message', (event) => {
  let message;
  try {
    message = JSON.parse(String(event.data));
  } catch {
    return;
  }
  if (message && message.topic === 'pos/update') {
    void publish('pos-seen', { lat: message.payload && message.payload.lat });
  }
});

socket.addEventListener('error', () => {
  /* the Core going away is not an add-on error worth crashing over */
});

// Keep the process alive even if the socket closes -- the Core stops us.
setInterval(() => {}, 60_000);
