import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';

export interface SandboxMail {
  recipient: string;
  from: string;
  headers: Record<string, string>;
  text: string;
}

interface DeliveryAttempt {
  messageId: string;
  accepted: boolean;
}

// Test-only SMTP mailbox. It never forwards mail or exposes messages over HTTP.
export class SmtpSandbox {
  readonly messages: SandboxMail[] = [];
  readonly attempts: DeliveryAttempt[] = [];
  authenticatedConnections = 0;
  private readonly sockets = new Set<Socket>();
  private readonly server: Server;
  private rejectNext = false;

  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {
    this.server = createServer((socket) => this.accept(socket));
  }

  async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    return (this.server.address() as AddressInfo).port;
  }

  rejectNextDelivery(): void {
    this.rejectNext = true;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on('close', () => this.sockets.delete(socket));
    // Network failures are observable to the real SMTP client/worker.
    socket.on('error', () => socket.destroy());
    socket.write('220 sandbox.local ESMTP test mailbox\r\n');
    let buffer = '';
    let authenticated = false;
    let from = '';
    let recipient = '';
    let data: string[] | null = null;
    let authStep: 'plain' | 'username' | 'password' | null = null;
    let loginUsername = '';

    const authenticate = (username: string, password: string): void => {
      authenticated = username === this.username && password === this.password;
      if (authenticated) this.authenticatedConnections++;
      socket.write(authenticated ? '235 2.7.0 Authenticated\r\n' : '535 5.7.8 Invalid auth\r\n');
      authStep = null;
    };
    const plainAuth = (value: string): void => {
      const fields = Buffer.from(value, 'base64').toString('utf8').split('\0');
      authenticate(fields[1] ?? '', fields[2] ?? '');
    };

    const line = (value: string): void => {
      if (data) {
        if (value !== '.') {
          data.push(value.startsWith('..') ? value.slice(1) : value);
          return;
        }
        const mail = parseMail(data.join('\r\n'), from, recipient);
        const accepted = !this.rejectNext;
        this.rejectNext = false;
        this.attempts.push({ messageId: mail.headers['message-id'] ?? '', accepted });
        if (accepted) this.messages.push(mail);
        data = null;
        socket.write(accepted ? '250 2.0.0 Accepted\r\n' : '451 4.3.0 Temporary test failure\r\n');
        return;
      }
      if (authStep === 'plain') return plainAuth(value);
      if (authStep === 'username') {
        loginUsername = Buffer.from(value, 'base64').toString('utf8');
        authStep = 'password';
        socket.write('334 UGFzc3dvcmQ6\r\n');
        return;
      }
      if (authStep === 'password') {
        return authenticate(loginUsername, Buffer.from(value, 'base64').toString('utf8'));
      }
      const command = value.toUpperCase();
      if (command.startsWith('EHLO ') || command.startsWith('HELO ')) {
        socket.write(
          '250-sandbox.local\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SIZE 1048576\r\n',
        );
      } else if (command.startsWith('AUTH PLAIN')) {
        const initial = value.split(' ')[2];
        if (initial) plainAuth(initial);
        else {
          authStep = 'plain';
          socket.write('334 \r\n');
        }
      } else if (command === 'AUTH LOGIN') {
        authStep = 'username';
        socket.write('334 VXNlcm5hbWU6\r\n');
      } else if (command.startsWith('MAIL FROM:') || command.startsWith('RCPT TO:')) {
        if (!authenticated) return void socket.write('530 5.7.0 Authentication required\r\n');
        const address = /<([^>]+)>/.exec(value)?.[1];
        if (!address) return void socket.write('501 5.1.3 Invalid address\r\n');
        if (command.startsWith('MAIL FROM:')) from = address;
        else recipient = address;
        socket.write('250 2.1.0 OK\r\n');
      } else if (command === 'DATA') {
        if (!authenticated || !from || !recipient) {
          socket.write('503 5.5.1 Missing envelope\r\n');
          return;
        }
        data = [];
        socket.write('354 End data with <CRLF>.<CRLF>\r\n');
      } else if (command === 'QUIT') socket.end('221 2.0.0 Bye\r\n');
      else if (command === 'RSET' || command === 'NOOP') socket.write('250 2.0.0 OK\r\n');
      else socket.write('502 5.5.1 Unsupported command\r\n');
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 1_048_576) {
        socket.end('552 5.3.4 Test mailbox size exceeded\r\n');
        return;
      }
      let end = buffer.indexOf('\r\n');
      while (end !== -1) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\r\n');
      }
    });
  }
}

function parseMail(raw: string, from: string, recipient: string): SandboxMail {
  const boundary = raw.indexOf('\r\n\r\n');
  const headerText = raw.slice(0, boundary).replace(/\r\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};
  for (const line of headerText.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon !== -1) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  let text = raw.slice(boundary + 4);
  if (headers['content-transfer-encoding'] === 'quoted-printable') {
    text = text
      .replace(/=\r\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
  } else if (headers['content-transfer-encoding'] === 'base64') {
    text = Buffer.from(text, 'base64').toString('utf8');
  }
  return { recipient, from, headers, text };
}
