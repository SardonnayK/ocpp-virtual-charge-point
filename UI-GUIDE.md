# OCPP Virtual Charge Point - UI Guide

## Quick Start

The OCPP Virtual Charge Point now includes a web-based user interface for easy management of multiple virtual charge points.

### Starting the UI

```bash
npm run ui
```

Then open your browser to: **http://localhost:3001**

## Features

✅ **Visual Management** - Create and control multiple chargers from a web interface  
✅ **Global Configuration** - Set default WebSocket URL and authentication  
✅ **Multi-Charger Support** - Run multiple virtual charge points simultaneously  
✅ **Real-time Status** - Monitor charger states in real-time  
✅ **OCPP 1.6, 2.0.1, 2.1** - Full support for all implemented OCPP versions  
✅ **TypeScript** - Fully typed for compatibility with existing codebase

## Usage Guide

### 1. Configure Global Settings

At the top of the page, set your default connection settings:

- **WebSocket URL**: The OCPP backend endpoint (e.g., `ws://localhost:9090/ocpp`)
- **Password**: Optional authentication password

Click the 💾 save icon to persist these settings.

### 2. Add Chargers

Click the **"+ Add Charger"** button and fill in:

- **Name**: A friendly name (e.g., "Station 1")
- **Serial**: Charge point serial number (e.g., "S001")
- **OCPP Version**: Select 1.6, 2.0.1, or 2.1
- **Number of Connectors**: 1-10 connectors per charger
- **WebSocket URL** (optional): Override global URL for this charger
- **Password** (optional): Override global password for this charger

### 3. Control Chargers

**Individual Control:**

- Click **▶ Start** to start a charger
- Click **⏹ Stop** to stop a running charger
- Click **🗑️** to delete a charger

**Bulk Control:**

- **Start All**: Start all stopped chargers
- **Stop All**: Stop all running chargers

### 4. Monitor Status

Each charger card displays:

- **Status indicator**:
  - 🟢 Running - Actively connected
  - 🔴 Stopped - Not running
  - 🟡 Starting/Stopping - In transition
  - 🔴 Error - Failed to start/connect
- **Serial number**
- **Admin port** for programmatic access
- **WebSocket endpoint**
- **Connector list**

## Architecture

### How It Works

The UI system consists of:

1. **UI Server** (`ui/server.ts`)

   - Manages multiple VCP instances
   - Provides REST API for charger control
   - Serves the web interface
   - Runs on port 3001 (configurable via `UI_PORT`)

2. **Web Client** (`ui/client.ts`)

   - Browser-side TypeScript application
   - Handles user interactions
   - Polls server for status updates
   - Displays charger state in real-time

3. **Styling** (`ui/styles.css`)

   - Modern, responsive design
   - Purple gradient theme
   - Card-based layout

4. **Type Definitions** (`ui/types.ts`)
   - Shared TypeScript interfaces
   - Ensures type safety across client/server

### Integration

The UI fully integrates with existing code:

- Uses the same `VCP` class from `src/vcp.ts`
- Supports all existing OCPP message handlers
- Compatible with transaction management
- Each charger gets its own admin port for API access

## API Reference

The UI server exposes these endpoints:

### Configuration

- `GET /api/config` - Get global settings
- `POST /api/config` - Update global settings

### Charger Management

- `GET /api/chargers` - List all chargers
- `POST /api/chargers` - Create a new charger
- `POST /api/chargers/:id/start` - Start a charger
- `POST /api/chargers/:id/stop` - Stop a charger
- `DELETE /api/chargers/:id` - Delete a charger

### Bulk Operations

- `POST /api/chargers/start-all` - Start all chargers
- `POST /api/chargers/stop-all` - Stop all chargers

## Environment Variables

```bash
# UI server port (default: 3001)
UI_PORT=8080 npm run ui
```

## Comparison: CLI vs UI

### Command Line (Original)

```bash
# Run a single charger
WS_URL=ws://localhost:9090/ocpp \
CP_ID=charger_001 \
ADMIN_PORT=10000 \
npx tsx index_16.ts
```

### Web UI (New)

1. Open http://localhost:3001
2. Click "Add Charger"
3. Fill in details
4. Click "Start"

✨ **Advantages:**

- Manage multiple chargers from one interface
- Visual status monitoring
- No need to manage environment variables
- Easy start/stop control
- No terminal juggling

## Development

### Build Client Only

```bash
npm run ui:build
```

### Start Server (assumes client is built)

```bash
tsx ui/server.ts
```

### Full Start (build + start)

```bash
npm run ui
```

## Troubleshooting

### Port Already in Use

```bash
# Use a different port
UI_PORT=3002 npm run ui
```

### Charger Won't Start

- Check that the WebSocket URL is correct
- Verify the OCPP backend is running
- Check browser console for errors
- Review the terminal output for logs

### Can't Connect to UI

- Ensure the server started successfully
- Check that port 3001 is not blocked
- Try http://127.0.0.1:3001 instead

## Future Enhancements

Potential improvements:

- [ ] Persist charger configurations to disk
- [ ] WebSocket updates for real-time status (instead of polling)
- [ ] View OCPP message logs per charger
- [ ] Transaction management UI
- [ ] Connector-level controls
- [ ] Export/import charger configurations
- [ ] Dark mode theme

## Notes

- Chargers are stored in memory (lost on restart)
- Each charger gets a unique admin port (10000+)
- The UI polls for updates every 2 seconds
- All chargers run in the same Node.js process
- Compatible with existing admin API endpoints

---

For more details, see `ui/README.md`
