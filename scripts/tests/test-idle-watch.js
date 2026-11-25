'use strict';

/* Verifies the IDLE watcher against the real MailService, with a minimal fake
   IMAP server instead of a provider (no credentials needed, no real mail). */

const net = require('net');
const fs = require('fs');
const path = require('path');
const { MailService } = require('../../src/main/mail');

const checks = [];
const want = (label, ok, detail) => checks.push([label, ok, detail]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeout = 6000, step = 40) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await wait(step);
  }
  return false;
}

function createFakeServer(mode = 'ok') {
  const state = {
    connections: 0,
    openSockets: new Set(),
    idleSockets: new Map(),
    selected: 0,
    idles: 0,
    logins: 0,
    loginRejected: 0,
    mode
  };

  const server = net.createServer((socket) => {
    state.connections += 1;
    state.openSockets.add(socket);
    socket.setEncoding('utf8');
    socket.write('* OK fake IMAP4rev1 ready\r\n');

    let buffer = '';
    let idleTag = null;

    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (!line) continue;

        if (idleTag && line.trim().toUpperCase() === 'DONE') {
          socket.write(`${idleTag} OK IDLE terminated\r\n`);
          state.idleSockets.delete(socket);
          idleTag = null;
          continue;
        }

        const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
        if (!match) continue;
        const tag = match[1];
        const command = match[2].toUpperCase();

        switch (command) {
          case 'CAPABILITY':
            socket.write('* CAPABILITY IMAP4rev1 IDLE UIDPLUS\r\n');
            socket.write(`${tag} OK CAPABILITY completed\r\n`);
            break;
          case 'LOGIN':
            if (state.mode === 'authfail') {
              state.loginRejected += 1;
              socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
            } else {
              state.logins += 1;
              socket.write(`${tag} OK LOGIN completed\r\n`);
            }
            break;
          case 'ID':
            socket.write('* ID ("name" "fake-imap")\r\n');
            socket.write(`${tag} OK ID completed\r\n`);
            break;
          case 'ENABLE':
            socket.write('* ENABLED ENABLE\r\n');
            socket.write(`${tag} OK ENABLE completed\r\n`);
            break;
          case 'SELECT':
          case 'EXAMINE':
            state.selected += 1;
            socket.write('* 3 EXISTS\r\n');
            socket.write('* 0 RECENT\r\n');
            socket.write('* FLAGS (\\Seen \\Flagged \\Deleted \\Answered \\Draft)\r\n');
            socket.write('* OK [UIDVALIDITY 1] UIDs valid\r\n');
            socket.write('* OK [UIDNEXT 90] Predicted next UID\r\n');
            socket.write(`${tag} OK [READ-WRITE] ${command} completed\r\n`);
            break;
          case 'IDLE':
            state.idles += 1;
            idleTag = tag;
            state.idleSockets.set(socket, tag);
            socket.write('+ idling\r\n');
            break;
          case 'NOOP':
            socket.write(`${tag} OK NOOP completed\r\n`);
            break;
          case 'LOGOUT':
            socket.write('* BYE logging out\r\n');
            socket.write(`${tag} OK LOGOUT completed\r\n`);
            socket.end();
            break;
          default:
            socket.write(`${tag} OK ${command} completed\r\n`);
            break;
        }
      }
    });

    const cleanup = () => {
      state.openSockets.delete(socket);
      state.idleSockets.delete(socket);
      idleTag = null;
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        state,
        push(count) {
          for (const socket of state.idleSockets.keys()) {
            socket.write(`* ${count} EXISTS\r\n`);
          }
        },
        dropAll() {
          for (const socket of [...state.openSockets]) socket.destroy();
        },
        close() {
          for (const socket of [...state.openSockets]) socket.destroy();
          return new Promise((done) => server.close(() => done()));
        }
      });
    });
  });
}

function makeStore(account, password = 'test-pass') {
  const accounts = new Map([[account.id, account]]);
  return {
    listAccounts: () => [...accounts.values()],
    getAccount: (id) => accounts.get(id) || null,
    getPassword: () => password,
    draftCount: () => 0
  };
}

function accountFor(port, id = 'acct-1') {
  return {
    id,
    email: 'tester@example.com',
    name: 'Tester',
    color: '#3b82f6',
    imap: { host: '127.0.0.1', port, secure: false },
    smtp: { host: '127.0.0.1', port, secure: false }
  };
}

async function main() {
  const fake = await createFakeServer();
  const account = accountFor(fake.port);
  const mail = new MailService(makeStore(account), { idleRetryMs: [150] });
  const events = [];
  mail.onNewMail = (accountId, mailboxPath, count) => events.push({ accountId, mailboxPath, count });

  mail.watch(account.id);
  const connected = await waitFor(() => fake.state.logins === 1 && fake.state.selected === 1);
  want('watcher logs in and selects INBOX', connected, JSON.stringify(fake.state));
  const idling = await waitFor(() => fake.state.idleSockets.size === 1, 4000);
  want('auto-IDLE starts without an explicit idle() call', idling, `idles=${fake.state.idles}`);

  fake.push(4);
  await waitFor(() => events.length === 1, 2000);
  want('new EXISTS notifies once', events.length === 1 && events[0].count === 4, JSON.stringify(events));

  fake.push(4);
  await wait(300);
  want('same EXISTS count does not notify again', events.length === 1, JSON.stringify(events));

  fake.push(5);
  await waitFor(() => events.length === 2, 2000);
  want('second increase notifies', events.length === 2 && events[1].count === 5, JSON.stringify(events));

  const beforeDrop = fake.state.connections;
  fake.dropAll();
  const reconnected = await waitFor(
    () => fake.state.connections > beforeDrop && fake.state.idleSockets.size === 1,
    4000
  );
  want('dropped connection reconnects and re-idles', reconnected, `connections=${fake.state.connections}`);
  fake.push(7);
  const afterReconnect = await waitFor(() => events.length === 3, 2000);
  want('reconnected watcher still notifies', afterReconnect && events[2].count === 7, JSON.stringify(events));

  mail.unwatch(account.id);
  const closed = await waitFor(() => fake.state.openSockets.size === 0, 2000);
  want('unwatch closes the watcher connection', closed, `open=${fake.state.openSockets.size}`);
  want('unwatch leaves no retry scheduled', mail.watchers.size === 0, `watchers=${mail.watchers.size}`);

  const unknown = await mail.syncOne('missing').then(
    () => 'resolved',
    (err) => `rejected:${err.message}`
  );
  want('syncOne rejects unknown accounts', unknown === 'rejected:账户不存在', unknown);

  await fake.close();

  const authFake = await createFakeServer('authfail');
  const authAccount = accountFor(authFake.port, 'acct-2');
  const authMail = new MailService(makeStore(authAccount), { idleRetryMs: [100] });
  authMail.watch(authAccount.id);
  await waitFor(() => authFake.state.loginRejected === 1, 4000);
  await wait(500);
  want('rejected credentials stop the watcher', authMail.watchers.size === 0, `watchers=${authMail.watchers.size}`);
  want('rejected credentials do not retry', authFake.state.connections === 1, `connections=${authFake.state.connections}`);
  await authFake.close();

  const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', file), 'utf8');
  const mainJs = read('main/main.js');
  const preload = read('preload/preload.js');
  const renderer = read('renderer/app.js');
  want('boot starts watchers', mainJs.includes('mail.watchAll()'));
  want('main forwards pushes to windows', mainJs.includes("send('mail:push'"));
  want('main exposes folders:sync-one', mainJs.includes("handle('folders:sync-one'"));
  want('saved account gets a watcher', mainJs.includes('mail.watch(saved.id)'));
  want('preload exposes syncOne', preload.includes("call('folders:sync-one'"));
  want('preload exposes onPush', preload.includes('onPush: onMailPush'));
  want('renderer subscribes after the first sync', renderer.includes('subscribeMailPush()'));
  want('renderer refreshes one account per push', renderer.includes('api.folders.syncOne(accountId)'));
  want('push path reuses detectNewMail', renderer.includes('await detectNewMail()'));

  let failed = 0;
  for (const [label, ok, detail] of checks) {
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  <${detail}>`}`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL  harness crashed:', err);
  process.exit(1);
});
