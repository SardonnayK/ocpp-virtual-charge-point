# OCPP Virtual Charge Point Manager UI

A web-based user interface for managing multiple OCPP virtual charge points.

## Features

- **Visual Management**: Create and manage multiple virtual charge points from a web interface
- **Global Configuration**: Set default WebSocket URL and password for all chargers
- **Individual Charger Control**: Start/stop chargers individually or all at once
- **Multi-Connector Support**: Configure multiple connectors per charger
- **OCPP Version Support**: Supports OCPP 1.6, 2.0.1, and 2.1
- **Real-time Status**: Monitor charger status in real-time
- **TypeScript Implementation**: Full TypeScript for type safety and compatibility

## Usage

### Starting the UI Server

```bash
npm run ui
```

This will:

1. Compile the client-side TypeScript
2. Start the UI server on port 3001 (default)

Then open your browser to: `http://localhost:3001`

### Environment Variables

You can customize the UI server port:

```bash
UI_PORT=8080 npm run ui
```

### Using the Interface

1. **Configure Global Settings**

   - Set the WebSocket URL (e.g., `ws://localhost:9090/ocpp`)
   - Optionally set a password for authentication
   - Click the save icon to persist settings

2. **Add a Charger**

   - Click "Add Charger" button
   - Fill in the form:
     - Name: A friendly name for identification
     - Serial: The charge point serial number
     - OCPP Version: Select 1.6, 2.0.1, or 2.1
     - Number of Connectors: How many charging connectors (1-10)
     - WebSocket URL (optional): Override the global URL
     - Password (optional): Override the global password
   - Click "Add Charger"

3. **Start/Stop Chargers**

   - Use individual "Start" buttons to start specific chargers
   - Use "Start All" / "Stop All" for bulk operations
   - Status indicators show the current state:
     - 🟢 Running - Charger is active
     - 🔴 Stopped - Charger is not running
     - 🟡 Starting/Stopping - Transition state
     - 🔴 Error - Something went wrong

4. **Delete Chargers**
   - Click the trash icon (🗑️) on any charger card
   - Confirm the deletion

## Architecture

### Files

- **`server.ts`**: Main UI server that manages VCP instances and serves the web interface
- **`client.ts`**: Browser-side TypeScript for UI interactions and API calls
- **`styles.css`**: Styling for the web interface
- **`types.ts`**: Shared TypeScript type definitions

### API Endpoints

The UI server exposes the following REST API:

- `GET /` - Serves the main HTML interface
- `GET /api/config` - Get global configuration
- `POST /api/config` - Update global configuration
- `GET /api/chargers` - List all chargers
- `POST /api/chargers` - Add a new charger
- `POST /api/chargers/:id/start` - Start a specific charger
- `POST /api/chargers/:id/stop` - Stop a specific charger
- `DELETE /api/chargers/:id` - Delete a charger
- `POST /api/chargers/start-all` - Start all chargers
- `POST /api/chargers/stop-all` - Stop all chargers

### How It Works

1. The UI server creates and manages `VCP` instances
2. Each charger gets a unique admin port (starting from 10000)
3. When a charger starts, it:
   - Creates a new VCP instance with the configured settings
   - Connects to the OCPP backend
   - Sends a BootNotification
   - Sends StatusNotification for each connector
4. The UI polls the server every 2 seconds for status updates
5. All chargers run independently in the same Node.js process

## Integration with Existing Code

The UI fully integrates with the existing OCPP VCP codebase:

- Uses the same `VCP` class from `src/vcp.ts`
- Supports all OCPP versions already implemented
- Uses the same message handlers and transaction managers
- Maintains compatibility with the existing admin API

## Development

### Building Client Code

```bash
npm run ui:build
```

This compiles `client.ts` to `client.js` for the browser.

### Type Checking

The client and server code are written in TypeScript for type safety and better integration with the existing codebase.

## Notes

- Each charger instance gets its own admin port for programmatic control
- The UI server runs on port 3001 by default (configurable via `UI_PORT`)
- Chargers are stored in memory; they will be lost on server restart
- Future enhancement: Add persistence layer for charger configurations
