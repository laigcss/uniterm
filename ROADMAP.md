# Roadmap

This document tracks the protocols and core features uniTerm already ships, and what we plan to build next. For per-release details, see [CHANGELOG.md](CHANGELOG.md).

Legend: ✅ Shipped, 🚧 Planned

## Protocol Support

### Terminal

| Protocol | Status | Since | Notes |
|----------|--------|-------|-------|
| SSH | ✅ | initial release | Remote shell over SSH |
| Local | ✅ | v2026.05.23-alpha | Local shell (PowerShell / CMD / Git Bash / bash / zsh) |
| Telnet | ✅ | v2026.06.02-alpha | Remote terminal for legacy devices |
| Mosh | ✅ | v2026.06.02-alpha | Roaming-friendly terminal over UDP |
| Serial | ✅ | v1.1.0 | Serial port terminal |
| WSL | ✅ | v1.1.0 | Open installed WSL distributions |

### File Transfer

| Protocol | Status | Since | Notes |
|----------|--------|-------|-------|
| SFTP | ✅ | v2026.05.16-alpha | Dual-pane file manager over SSH |
| Zmodem | ✅ | v2026.06.12-alpha | In-terminal file transfer (`rz` / `sz`) |
| FTP / FTPS | ✅ | v2026.06.14-alpha | FTP and FTPS file transfer |
| SMB | ✅ | v1.2.2 | Windows shared folders and NAS |
| WebDAV | ✅ | v1.2.2 | WebDAV file management |
| S3 | ✅ | v1.2.2 | Amazon S3 compatible object storage |

### Remote Desktop

| Protocol | Status | Since | Notes |
|----------|--------|-------|-------|
| RDP (client on Windows) | ✅ | v2026.05.22-alpha | Windows Remote Desktop |
| VNC | ✅ | v2026.05.23-alpha | VNC remote control |
| SPICE | ✅ | v2026.06.08-alpha | KVM / QEMU VM console |
| X11 Forwarding | 🚧 | — | Forward remote X applications over SSH |
| RDP (client on macOS / Linux) | 🚧 | — | Windows Remote Desktop on macOS / Linux |

### Database

| Protocol | Status | Since | Notes |
|----------|--------|-------|-------|
| MySQL | ✅ | v2026.05.27-alpha | Also covers MariaDB, TiDB, etc. |
| PostgreSQL | ✅ | v2026.05.27-alpha | Also covers CockroachDB, etc. |
| rqlite | ✅ | v2026.05.27-alpha | Distributed SQLite with Raft |
| Oracle | ✅ | v1.2.0 | Oracle Database |
| SQL Server | ✅ | v1.2.0 | Microsoft SQL Server |
| Redis | ✅ | v1.2.1 | Key-value store with visual browser |
| MongoDB | ✅ | v1.4.1 | Document database |
| ClickHouse | 🚧 | — | Column-oriented OLAP database |
| etcd | 🚧 | — | Distributed key-value store |

### Container

| Protocol | Status | Since | Notes |
|----------|--------|-------|-------|
| Kubernetes | 🚧 | — | Cluster browsing and pod management |
| Docker | 🚧 | — | Manage remote containers over SSH |
| nerdctl | 🚧 | — | Manage remote containers over SSH |
| Podman | 🚧 | — | Manage remote containers over SSH |

## Core Features

### AI Assistant

| Feature | Status | Since | Notes |
|---------|--------|-------|-------|
| Anthropic Provider | ✅ | v2026.06.13-alpha | Anthropic-compatible Messages API |
| OpenAI Provider | ✅ | v1.1.1 | OpenAI-compatible Chat Completions API |
| Message Queue | ✅ | v1.4.1 | Queue messages while the agent is running |
| NL Database Query | ✅ | v1.4.1 | Natural-language database query generation |
| Multi-Panel AI Lock | ✅ | v1.5.0 | Control multiple terminals simultaneously |
| Skill Support | 🚧 | — | Packaged, reusable workflows the agent can invoke |
| Prompt Library | 🚧 | — | Manage and trigger reusable AI prompts |
| Interaction Modes | 🚧 | — | Chat / read-only / agent modes to constrain AI actions |
| MCP Server | 🚧 | — | Expose uniTerm as an MCP server for external AI agents |
| MCP Client | 🚧 | — | Connect external MCP servers to extend uniTerm's AI |
| File Attachments | 🚧 | — | Attach files to AI prompts for the agent to read |

### Personalization

| Feature | Status | Since | Notes |
|---------|--------|-------|-------|
| UI Themes | ✅ | initial release | Dark / Deep Blue / Light |
| Terminal Themes | ✅ | initial release | Built-in terminal color themes |
| Internationalization | ✅ | v2026.06.10-alpha | Multi-language UI |
| Custom Keybindings | ✅ | v1.1.1 | Rebindable keyboard shortcuts |
| Background Image | ✅ | v1.5.2 | Customizable application background |

### Productivity

| Feature | Status | Since | Notes |
|---------|--------|-------|-------|
| Workspace | ✅ | v2026.05.13-alpha | Split panes and broadcast input |
| Cloud Sync | ✅ | v2026.05.24-alpha | Encrypted sync via your own private repo |
| Terminal Search | ✅ | v2026.05.27-alpha | In-terminal text search |
| Command History | ✅ | v2026.05.29-alpha | Searchable terminal command history |
| Smart Completion | ✅ | v2026.05.29-alpha | Real-time command suggestions |
| Server Monitor | ✅ | v2026.05.29-alpha | Real-time server metrics |
| Text Highlighting | ✅ | v2026.06.02-alpha | Terminal text highlighting |
| SSH Jump Host | ✅ | v2026.06.14-alpha | Route connections through an SSH jump host |
| Quick Commands | ✅ | v1.0.1 | Manage and run reusable commands |
| SSH Tunnel Manager | ✅ | v1.4.1 | Local, remote, and dynamic port forwarding |
| Session Recording | ✅ | v1.5.0 | Record terminal output to file |
| Connection Import / Export | 🚧 | — | Import and export connection configurations |

## Contributing

Have a feature to propose or a planned item you'd like to pick up? Open an issue or PR on [GitHub](https://github.com/ys-ll/uniterm/issues) — we discuss roadmap items there.
