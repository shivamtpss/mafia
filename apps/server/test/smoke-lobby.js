// Standalone smoke test: boots nothing, connects two socket.io clients to a
// running server and exercises create/join/ready/start. Run against a live
// server at SERVER_URL (default http://localhost:4000).
const { io } = require('socket.io-client');

const URL = process.env.SERVER_URL || 'http://localhost:4000';

function call(sock, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${event}`)), 5000);
    const cb = (res) => {
      clearTimeout(t);
      resolve(res);
    };
    if (payload === undefined) sock.emit(event, cb);
    else sock.emit(event, payload, cb);
  });
}

function connect(auth) {
  return new Promise((resolve, reject) => {
    const sock = io(URL, { auth: auth || {}, transports: ['websocket'] });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', reject);
  });
}

(async () => {
  const host = await connect();
  const guest = await connect();
  let hostRoomUpdates = 0;
  host.on('room:updated', () => hostRoomUpdates++);

  const created = await call(host, 'room:create', {
    displayName: 'HostAlice',
    avatar: 'fox',
  });
  if (!created.ok) throw new Error('create failed: ' + JSON.stringify(created));
  const code = created.data.room.code;
  console.log('✓ room created', code, 'host selfId', created.data.selfId);

  const joined = await call(guest, 'room:join', {
    code,
    displayName: 'GuestBob',
    avatar: 'owl',
  });
  if (!joined.ok) throw new Error('join failed: ' + JSON.stringify(joined));
  console.log('✓ guest joined; players =', joined.data.room.players.length);
  if (joined.data.room.players.length !== 2) throw new Error('expected 2 players');

  // Negative: duplicate name should fail.
  const dup = await connect();
  const dupRes = await call(dup, 'room:join', {
    code,
    displayName: 'hostalice',
    avatar: 'wolf',
  });
  if (dupRes.ok) throw new Error('expected duplicate-name rejection');
  console.log('✓ duplicate name rejected with', dupRes.error.code);
  dup.close();

  // Not enough players to start (need 4).
  const earlyStart = await call(host, 'game:start');
  if (earlyStart.ok) throw new Error('expected not-enough-players');
  console.log('✓ early start rejected with', earlyStart.error.code);

  // Add two more and ready up.
  const c = await connect();
  const d = await connect();
  await call(c, 'room:join', { code, displayName: 'Cara', avatar: 'cat' });
  await call(d, 'room:join', { code, displayName: 'Dan', avatar: 'bear' });
  await call(guest, 'player:ready', { isReady: true });
  await call(c, 'player:ready', { isReady: true });
  await call(d, 'player:ready', { isReady: true });

  // Non-host cannot start.
  const badStart = await call(guest, 'game:start');
  if (badStart.ok) throw new Error('expected not-host');
  console.log('✓ non-host start rejected with', badStart.error.code);

  // Host starts.
  let phaseChanged = null;
  guest.on('phase:changed', (p) => (phaseChanged = p));
  const start = await call(host, 'game:start');
  if (!start.ok) throw new Error('start failed: ' + JSON.stringify(start));
  console.log('✓ game started, phase =', start.data.phase);

  await new Promise((r) => setTimeout(r, 200));
  if (!phaseChanged) throw new Error('guest did not receive phase:changed');
  console.log('✓ guest received phase:changed ->', phaseChanged.phase);

  // Chat broadcast.
  let gotChat = null;
  guest.on('chat:message', (m) => (gotChat = m));
  await call(host, 'chat:send', { text: 'Hello town!' });
  await new Promise((r) => setTimeout(r, 200));
  if (!gotChat || gotChat.text !== 'Hello town!')
    throw new Error('chat not received');
  console.log('✓ chat broadcast received:', gotChat.authorName, '->', gotChat.text);

  console.log('\nAll smoke checks passed. hostRoomUpdates =', hostRoomUpdates);
  [host, guest, c, d].forEach((s) => s.close());
  process.exit(0);
})().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
