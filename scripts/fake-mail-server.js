'use strict';

/* Minimal IMAP + SMTP pair for black-boxing the packaged app without real
   credentials. The IMAP side accepts one IDLE and then "delivers" a message
   after FAKE_PUSH_DELAY_MS so the UI must react to a push, not to a poll. */

const fs = require('fs');
const net = require('net');
const path = require('path');
const tls = require('tls');

const IMAP_PORT = Number(process.env.FAKE_IMAP_PORT || 11430);
const SMTP_PORT = Number(process.env.FAKE_SMTP_PORT || 12550);
const PUSH_DELAY_MS = Number(process.env.FAKE_PUSH_DELAY_MS || 6000);

/* The app's SMTP transport sets requireTLS, so the account test needs a real
   STARTTLS handshake. Generate the self-signed pair with:
     openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=127.0.0.1" \
       -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" \
       -keyout tmp/certs/fake-key.pem -out tmp/certs/fake-cert.pem
   then launch the app with NODE_EXTRA_CA_CERTS pointing at fake-cert.pem. */
const TLS_CERT = path.join(__dirname, '..', 'tmp', 'certs', 'fake-cert.pem');
const TLS_KEY = path.join(__dirname, '..', 'tmp', 'certs', 'fake-key.pem');

const state = { messages: 10, unseen: 2, idles: 0, pushed: false, connections: 0 };
let pushedPayload = null;

function folderCounts(name) {
  const upper = String(name || '').toUpperCase();
  if (upper.includes('INBOX')) return { messages: state.messages, unseen: state.unseen };
  return { messages: 3, unseen: 0 };
}

function startImap() {
  const server = net.createServer((socket) => {
    state.connections += 1;
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

        const trimmed = line.trim();
        if (idleTag && trimmed.toUpperCase() === 'DONE') {
          socket.write(`${idleTag} OK IDLE terminated\r\n`);
          idleTag = null;
          continue;
        }

        const match = line.match(/^(\S+)\s+(\S+)(?:\s+([\s\S]*))?$/);
        if (!match) continue;
        const tag = match[1];
        const command = match[2].toUpperCase();
        const rest = (match[3] || '').trim();

        switch (command) {
          case 'CAPABILITY':
            socket.write('* CAPABILITY IMAP4rev1 IDLE UIDPLUS\r\n');
            socket.write(`${tag} OK CAPABILITY completed\r\n`);
            break;
          case 'LOGIN':
            socket.write(`${tag} OK LOGIN completed\r\n`);
            break;
          case 'ID':
            socket.write('* ID ("name" "fake-imap")\r\n');
            socket.write(`${tag} OK ID completed\r\n`);
            break;
          case 'ENABLE':
            socket.write('* ENABLED ENABLE\r\n');
            socket.write(`${tag} OK ENABLE completed\r\n`);
            break;
          case 'LIST':
          case 'LSUB':
            socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');
            socket.write('* LIST (\\HasNoChildren) "/" "Sent"\r\n');
            socket.write('* LIST (\\HasNoChildren \\Drafts) "/" "Drafts"\r\n');
            socket.write('* LIST (\\HasNoChildren \\Trash) "/" "Trash"\r\n');
            socket.write('* LIST (\\HasNoChildren \\Archive) "/" "Archive"\r\n');
            socket.write(`${tag} OK LIST completed\r\n`);
            break;
          case 'STATUS': {
            const nameMatch = rest.match(/^("([^"]*)"|\S+)/);
            const rawName = nameMatch ? (nameMatch[2] || nameMatch[1]).replace(/"/g, '') : 'INBOX';
            const counts = folderCounts(rawName);
            socket.write(
              `* STATUS "${rawName}" (MESSAGES ${counts.messages} UNSEEN ${counts.unseen})\r\n`
            );
            socket.write(`${tag} OK STATUS completed\r\n`);
            break;
          }
          case 'SELECT':
          case 'EXAMINE': {
            const counts = folderCounts('INBOX');
            socket.write(`* ${counts.messages} EXISTS\r\n`);
            socket.write('* 0 RECENT\r\n');
            socket.write('* FLAGS (\\Seen \\Flagged \\Deleted \\Answered \\Draft)\r\n');
            socket.write('* OK [UIDVALIDITY 1] UIDs valid\r\n');
            socket.write('* OK [UIDNEXT 200] Predicted next UID\r\n');
            socket.write(`* OK [UNSEEN ${counts.unseen}] first unseen\r\n`);
            socket.write(`${tag} OK [READ-WRITE] ${command} completed\r\n`);
            break;
          }
          case 'FETCH':
          case 'UID':
            if (command === 'UID' && !/^FETCH/i.test(rest)) {
              socket.write(`${tag} OK completed\r\n`);
              break;
            }
            socket.write(
              '* 1 FETCH (UID 101 FLAGS () INTERNALDATE "01-Nov-2026 10:00:00 +0000" ' +
                'ENVELOPE ("Sun, 01 Nov 2026 10:00:00 +0000" "IDLE push test" ' +
                '(("Tester" NIL "tester" "idle.local")) ' +
                '(("Tester" NIL "tester" "idle.local")) ' +
                '(("Tester" NIL "tester" "idle.local")) ' +
                '(("Tester" NIL "tester" "idle.local")) NIL NIL NIL "<101@idle.local>"))\r\n'
            );
            socket.write(`${tag} OK FETCH completed\r\n`);
            break;
          case 'IDLE':
            state.idles += 1;
            idleTag = tag;
            socket.write('+ idling\r\n');
            if (!pushedPayload && state.idles === 1) {
              pushedPayload = socket;
              setTimeout(() => {
                if (socket.destroyed) return;
                state.messages += 1;
                state.unseen += 1;
                state.pushed = true;
                socket.write(`* ${state.messages} EXISTS\r\n`);
              }, PUSH_DELAY_MS);
            }
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

    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(IMAP_PORT, '127.0.0.1', () => resolve(server));
  });
}

function startSmtp() {
  const server = net.createServer((socket) => {
    let buffer = '';
    let authStep = 0;
    let secured = false;
    let current = socket;

    const reply = (text) => current.write(text);

    const attach = (conn) => {
      conn.setEncoding('utf8');
      conn.on('error', () => {});
      conn.on('data', (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          handle(line);
        }
      });
    };

    const handle = (line) => {
      const upper = line.toUpperCase();

      if (authStep === 1) {
        reply('334 UGFzc3dvcmQ6\r\n');
        authStep = 2;
        return;
      }
      if (authStep === 2) {
        authStep = 0;
        reply('235 2.7.0 Authentication successful\r\n');
        return;
      }
      if (authStep === 3) {
        authStep = 0;
        reply('235 2.7.0 Authentication successful\r\n');
        return;
      }

      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        const extra = secured ? '' : '250-STARTTLS\r\n';
        reply(`250-fake\r\n250-AUTH PLAIN LOGIN\r\n${extra}250-SIZE 10485760\r\n250 8BITMIME\r\n`);
      } else if (upper === 'STARTTLS') {
        reply('220 Ready to start TLS\r\n');
        socket.removeAllListeners('data');
        socket.removeAllListeners('error');
        const secure = new tls.TLSSocket(socket, {
          isServer: true,
          key: fs.readFileSync(TLS_KEY),
          cert: fs.readFileSync(TLS_CERT)
        });
        current = secure;
        secured = true;
        buffer = '';
        authStep = 0;
        attach(secure);
      } else if (upper.startsWith('AUTH PLAIN')) {
        if (line.trim().split(/\s+/).length >= 3) {
          reply('235 2.7.0 Authentication successful\r\n');
        } else {
          authStep = 3;
          reply('334 \r\n');
        }
      } else if (upper.startsWith('AUTH LOGIN')) {
        authStep = 1;
        reply('334 VXNlcm5hbWU6\r\n');
      } else if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO') || upper.startsWith('RSET')) {
        reply('250 2.1.0 Ok\r\n');
      } else if (upper.startsWith('DATA')) {
        reply('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (line.trim() === '.') {
        reply('250 2.0.0 Ok: queued\r\n');
      } else if (upper.startsWith('QUIT')) {
        reply('221 Bye\r\n');
        current.end();
      } else {
        reply('250 Ok\r\n');
      }
    };

    reply('220 fake ESMTP ready\r\n');
    attach(socket);
  });

  return new Promise((resolve) => {
    server.listen(SMTP_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const imap = await startImap();
  const smtp = await startSmtp();
  console.log(`READY imap=${IMAP_PORT} smtp=${SMTP_PORT} pushDelayMs=${PUSH_DELAY_MS}`);

  const tick = setInterval(() => {
    console.log(
      `STATE imapConnections=${state.connections} idles=${state.idles} pushed=${state.pushed} ` +
        `messages=${state.messages} unseen=${state.unseen}`
    );
    if (state.pushed && state.idles > 0) {
      clearInterval(tick);
      setTimeout(() => {
        imap.close();
        smtp.close();
        console.log('DONE');
        process.exit(0);
      }, 4000);
    }
  }, 1000);
}

main().catch((err) => {
  console.error('FAKE_SERVER_FAILED', err);
  process.exit(1);
});
