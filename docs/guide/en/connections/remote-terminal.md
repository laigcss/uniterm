# Remote Terminal

uniTerm supports three remote terminal protocols: **SSH**, **Telnet**, and **Mosh**.

## SSH

SSH (Secure Shell) is the most commonly used protocol for remote server management, providing encrypted secure connections.

### Connection Parameters

| Parameter | Description |
|------|------|
| Host | Server IP or domain name |
| Port | Default 22 |
| Username | Login username |
| Authentication | Password or key |
| Password | Required for password authentication |
| Key Path | Select private key file for key authentication |
| Character Encoding | Terminal charset, default UTF-8. Also supports GBK, GB2312, Big5, Shift-JIS, etc. |
| Backspace Key | Byte sequence sent for backspace, default BS (0x08). Also supports DEL (0x7F) and VT220 Delete (ESC[3~) |
| SSH Tunnel | Select an existing SSH connection as a jump host to forward traffic to the target host |
| Startup Script | Commands automatically executed after the connection is established, one per line, executed sequentially |
| SFTP Max Concurrent Transfers | Maximum number of simultaneous SFTP file transfers, 0 for unlimited |
| X11 Forwarding | When enabled, remote X11 applications can display on the local X Server (macOS requires XQuartz; Windows has VcXsrv built-in) |
| Start Recording Log on Connect | Automatically start recording the session log when the connection is established |

### Authentication Methods

- **Password Authentication** -- Enter password to log in. If the password is not saved, a terminal prompt will appear for input upon connection.
- **Key Authentication** -- Select an SSH private key file (e.g. `~/.ssh/id_rsa`) for passwordless login.
- **Keyboard-Interactive Authentication** -- Always available as a fallback; automatically enables interactive authentication when password or key authentication fails.

### SSH Tunnel

Traffic from other connections can be forwarded through an SSH tunnel via a jump host, enabling intranet penetration. After selecting an existing SSH connection as the jump host, traffic to the target host will be encrypted and forwarded through that SSH connection. Different usernames and passwords can be specified for the tunnel.

### Post-Login Expect

The Expect/Send pattern supports interactive login automation by defining matching rules and send content in sequence:

- **expect** -- Wait for terminal output matching this text (supports regex, case-insensitive)
- **send** -- Text to send after a successful match. Supports `${password}`, `${user}`, and `${host}` variables
- **enter** -- Whether to append a carriage return after sending (default: yes)
- **timeout** -- Per-step timeout (default 10 seconds, max 120 seconds)

### Zmodem File Transfer

In an SSH terminal, you can directly use the `rz` (receive files) and `sz` (send files) commands to transfer files without opening the file browser. Drag-and-drop from the desktop to the terminal window for direct upload is also supported.

![Zmodem](/imgs/zmodem_light.webp)

### X11 Forwarding

With SSH X11 forwarding, graphical application windows from a remote Linux server can be displayed directly on the local desktop.

![X11 Forward](/imgs/x11_forward_light.webp)

> Windows version includes VcXsrv X Server built-in, ready to use out of the box. macOS users need to install XQuartz (`brew install --cask xquartz`).

### SSH Terminal Tab Operations

Tabs support drag-to-reorder and drag-to-split into panels. Right-click a tab to open a context menu:

| Menu Item | Description |
|--------|------|
| Duplicate Session | Duplicate the current SSH connection and open a new tab |
| Open SFTP | Open the SFTP file browser on the current connection |
| Upload File | Send the `rz -be` command to the terminal to receive files remotely |
| Open Server Monitor | Open the server monitoring panel on the current connection |
| Text Search | Search for keywords in terminal output |
| Export Text | Export current terminal output as a text file |

## Telnet

Telnet is a simple plain-text remote terminal protocol, commonly used for connecting to embedded devices, network equipment, and legacy systems.

### Connection Parameters

| Parameter | Description |
|------|------|
| Host | Device IP or domain name |
| Port | Default 23 |
| Username | Login username (optional, automatically sent after connection) |
| Password | Login password (optional, automatically sent after username) |
| Character Encoding | Terminal charset, default UTF-8. Also supports GBK, GB2312, Big5, Shift-JIS, etc. |
| Backspace Key | Byte sequence sent for backspace, default BS (0x08). Also supports DEL (0x7F) and VT220 Delete (ESC[3~) |
| Negotiation Mode | Active (default) or passive; affects which side initiates Telnet option negotiation |
| Send Mode | Character-at-a-time (default) or line-at-a-time |
| Local Echo | When enabled, input characters are echoed locally; when disabled, echo is handled by the server |
| Newline Mode | CR (default) or CR+LF |
| SSH Tunnel | Select an existing SSH connection as a jump host to forward traffic to the target host |
| Startup Script | Commands automatically executed after the connection is established |
| Start Recording Log on Connect | Automatically start recording the session log when the connection is established |

> Warning: Telnet transmits data without encryption. Use only on trusted networks.

## Mosh

Mosh (Mobile Shell) is designed for high-latency and intermittent networks. Based on UDP transport, the connection does not drop when switching networks (e.g. Wi-Fi to 4G).

### Connection Parameters

Same as SSH. uniTerm first connects to the server via SSH, then automatically starts `mosh-server` to establish a UDP session.

| Parameter | Description |
|------|------|
| Host | Server IP or domain name |
| Port | SSH port, default 22 |
| Username | Login username |
| Authentication | Password or key |
| Character Encoding | Terminal charset, default UTF-8. Also supports GBK, GB2312, Big5, Shift-JIS, etc. |
| Backspace Key | Byte sequence sent for backspace, default BS (0x08). Also supports DEL (0x7F) and VT220 Delete (ESC[3~) |
| Startup Script | Commands automatically executed after the connection is established |
| Start Recording Log on Connect | Automatically start recording the session log when the connection is established |

> Note: The server must have `mosh-server` installed before using Mosh. Mosh does not support SSH tunnels or the Expect/Send pattern.


::: tip Related
- [Server Monitor](/en/connections/server-monitor) -- Real-time SSH server monitoring
- [Getting Started](/en/getting-started) -- First connection tutorial
- [Local](/en/connections/local) -- Local Shell and Serial
:::
