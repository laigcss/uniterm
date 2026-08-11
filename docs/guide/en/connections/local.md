# Local

Open a terminal directly on the local machine or connect to serial devices without a network.

## Local Shell

### Connection Parameters

| Parameter | Description |
|------|------|
| Shell Type | Select which local shell to open |
| Character Encoding | Terminal charset, default UTF-8. Also supports GBK, GB2312, Big5, Shift-JIS, etc. |
| Backspace Key | Byte sequence sent for backspace, default BS (0x08). Also supports DEL (0x7F) and VT220 Delete (ESC[3~) |
| Startup Script | Commands or scripts automatically executed after terminal starts (optional) |
| Start Recording Log on Connect | Automatically start recording the session log when the connection is established |

Supported shell types (varies by operating system):

**Windows:**
- PowerShell
- CMD
- Git Bash
- WSL (installed Linux distributions)

**macOS / Linux:**
- bash
- zsh
- Other installed shells

## Serial

Connect to serial devices such as router consoles, embedded development boards, industrial equipment, etc.

### Connection Parameters

| Parameter | Description |
|------|------|
| Port | Serial port name (COMx on Windows, /dev/ttyUSBx on Linux) |
| Baud Rate | Transmission rate, commonly 9600 or 115200 |
| Data Bits | Data bits per frame, commonly 8 |
| Stop Bits | Stop bits, commonly 1 |
| Parity | Error detection, options: None, Even, Odd, Mark, Space |
| Character Encoding | Terminal charset, default UTF-8. Also supports GBK, GB2312, Big5, Shift-JIS, etc. |
| Backspace Key | Byte sequence sent for backspace, default BS (0x08). Also supports DEL (0x7F) and VT220 Delete (ESC[3~) |
| Local Echo | Whether to display input locally; enable as needed |
| Newline Mode | CR (default) or CR+LF |
| Start Recording Log on Connect | Automatically start recording the session log when the connection is established |


::: tip Related
- [Remote Terminal](/en/connections/remote-terminal) -- SSH/Telnet/Mosh remote connections
:::
