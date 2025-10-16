import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import * as fs from "node:fs";
import * as path from "node:path";
import { VCP } from "../src/vcp";
import { OcppVersion } from "../src/ocppVersion";
import type { ChargerConfig, ChargerState, GlobalConfig } from "./types";
import { bootNotificationOcppMessage } from "../src/v16/messages/bootNotification";
import { statusNotificationOcppMessage } from "../src/v16/messages/statusNotification";
import { logger } from "../src/logger";

interface ChargerInstance {
  vcp: VCP;
  config: ChargerConfig;
  status: "Stopped" | "Starting" | "Running" | "Stopping" | "Error";
}

class UIServer {
  private chargers: Map<string, ChargerInstance> = new Map();
  private globalConfig: GlobalConfig = {
    websocketUrl: "ws://localhost:9090/ocpp",
    password: undefined,
  };
  private app: Hono;

  constructor() {
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes() {
    // Enable CORS
    this.app.use("/*", cors());

    // Serve static files from ui folder
    this.app.get("/ui/:filename", (c) => {
      const filename = c.req.param("filename");
      const filePath = path.join(__dirname, filename);

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filename);
        let contentType = "text/plain";

        if (ext === ".css") contentType = "text/css";
        else if (ext === ".js") contentType = "application/javascript";
        else if (ext === ".json") contentType = "application/json";

        const content = fs.readFileSync(filePath, "utf-8");
        return c.body(content, 200, { "Content-Type": contentType });
      }

      return c.notFound();
    });

    // API Routes
    this.app.get("/api/chargers", (c) => {
      const chargerStates: ChargerState[] = Array.from(
        this.chargers.values()
      ).map((instance) => ({
        config: instance.config,
        status: instance.status,
      }));
      return c.json(chargerStates);
    });

    this.app.get("/api/config", (c) => {
      return c.json(this.globalConfig);
    });

    this.app.post("/api/config", async (c) => {
      const body = await c.req.json();
      this.globalConfig = {
        websocketUrl: body.websocketUrl || this.globalConfig.websocketUrl,
        password: body.password,
      };
      return c.json({ success: true });
    });

    this.app.post("/api/chargers", async (c) => {
      const config: ChargerConfig = await c.req.json();

      // Generate unique ID if not provided
      if (!config.id) {
        config.id = `charger_${Date.now()}`;
      }

      // Set default values
      config.websocketUrl =
        config.websocketUrl || this.globalConfig.websocketUrl;
      config.password = config.password || this.globalConfig.password;
      config.adminPort = config.adminPort || 10000 + this.chargers.size;

      this.chargers.set(config.id, {
        config,
        vcp: null as any, // Will be created when started
        status: "Stopped",
      });

      return c.json({ success: true, id: config.id });
    });

    this.app.post("/api/chargers/:id/start", async (c) => {
      const id = c.req.param("id");
      const instance = this.chargers.get(id);

      if (!instance) {
        return c.json({ error: "Charger not found" }, 404);
      }

      try {
        instance.status = "Starting";

        // Determine OCPP version
        let ocppVersion: OcppVersion;
        switch (instance.config.ocppVersion) {
          case "1.6":
            ocppVersion = OcppVersion.OCPP_1_6;
            break;
          case "2.0.1":
            ocppVersion = OcppVersion.OCPP_2_0_1;
            break;
          case "2.1":
            ocppVersion = OcppVersion.OCPP_2_1;
            break;
          default:
            ocppVersion = OcppVersion.OCPP_1_6;
        }

        // Create VCP instance
        const vcp = new VCP({
          endpoint: instance.config.websocketUrl,
          chargePointId: instance.config.serial,
          ocppVersion: ocppVersion,
          basicAuthPassword: instance.config.password,
          adminPort: instance.config.adminPort,
        });

        await vcp.connect();
        instance.vcp = vcp;
        instance.status = "Running";

        // Send boot notification
        if (instance.config.ocppVersion === "1.6") {
          vcp.send(
            bootNotificationOcppMessage.request({
              chargePointVendor: "Solidstudio",
              chargePointModel: "VirtualChargePoint",
              chargePointSerialNumber: instance.config.serial,
              firmwareVersion: "1.0.0",
            })
          );

          // Send status notification for each connector
          for (const connector of instance.config.connectors) {
            vcp.send(
              statusNotificationOcppMessage.request({
                connectorId: connector.id,
                errorCode: "NoError",
                status: connector.status,
              })
            );
          }
        }

        return c.json({ success: true });
      } catch (error) {
        instance.status = "Error";
        logger.error(`Failed to start charger ${id}:`, error);
        return c.json({ error: String(error) }, 500);
      }
    });

    this.app.post("/api/chargers/:id/stop", async (c) => {
      const id = c.req.param("id");
      const instance = this.chargers.get(id);

      if (!instance) {
        return c.json({ error: "Charger not found" }, 404);
      }

      try {
        instance.status = "Stopping";
        if (instance.vcp) {
          instance.vcp.close();
        }
        instance.status = "Stopped";
        return c.json({ success: true });
      } catch (error) {
        instance.status = "Error";
        return c.json({ error: String(error) }, 500);
      }
    });

    this.app.delete("/api/chargers/:id", async (c) => {
      const id = c.req.param("id");
      const instance = this.chargers.get(id);

      if (!instance) {
        return c.json({ error: "Charger not found" }, 404);
      }

      // Stop if running
      if (instance.vcp && instance.status === "Running") {
        try {
          instance.vcp.close();
        } catch (error) {
          logger.error(`Error stopping charger ${id}:`, error);
        }
      }

      this.chargers.delete(id);
      return c.json({ success: true });
    });

    this.app.post("/api/chargers/start-all", async (c) => {
      const results: Array<{ id: string; success: boolean; error?: string }> =
        [];

      for (const [id, instance] of this.chargers.entries()) {
        if (instance.status !== "Running") {
          try {
            // Similar logic to individual start
            instance.status = "Starting";

            let ocppVersion: OcppVersion;
            switch (instance.config.ocppVersion) {
              case "1.6":
                ocppVersion = OcppVersion.OCPP_1_6;
                break;
              case "2.0.1":
                ocppVersion = OcppVersion.OCPP_2_0_1;
                break;
              case "2.1":
                ocppVersion = OcppVersion.OCPP_2_1;
                break;
              default:
                ocppVersion = OcppVersion.OCPP_1_6;
            }

            const vcp = new VCP({
              endpoint: instance.config.websocketUrl,
              chargePointId: instance.config.serial,
              ocppVersion: ocppVersion,
              basicAuthPassword: instance.config.password,
              adminPort: instance.config.adminPort,
            });

            await vcp.connect();
            instance.vcp = vcp;
            instance.status = "Running";

            if (instance.config.ocppVersion === "1.6") {
              vcp.send(
                bootNotificationOcppMessage.request({
                  chargePointVendor: "Solidstudio",
                  chargePointModel: "VirtualChargePoint",
                  chargePointSerialNumber: instance.config.serial,
                  firmwareVersion: "1.0.0",
                })
              );

              for (const connector of instance.config.connectors) {
                vcp.send(
                  statusNotificationOcppMessage.request({
                    connectorId: connector.id,
                    errorCode: "NoError",
                    status: connector.status,
                  })
                );
              }
            }

            results.push({ id, success: true });
          } catch (error) {
            instance.status = "Error";
            results.push({ id, success: false, error: String(error) });
          }
        }
      }

      return c.json({ results });
    });

    this.app.post("/api/chargers/stop-all", async (c) => {
      const results: Array<{ id: string; success: boolean; error?: string }> =
        [];

      for (const [id, instance] of this.chargers.entries()) {
        if (instance.status === "Running") {
          try {
            instance.status = "Stopping";
            if (instance.vcp) {
              instance.vcp.close();
            }
            instance.status = "Stopped";
            results.push({ id, success: true });
          } catch (error) {
            instance.status = "Error";
            results.push({ id, success: false, error: String(error) });
          }
        }
      }

      return c.json({ results });
    });

    // Serve the main HTML page
    this.app.get("/", (c) => {
      return c.html(this.getHTMLContent());
    });
  }

  private getHTMLContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OCPP Virtual Charge Point Manager</title>
    <link rel="stylesheet" href="/ui/styles.css">
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-left">
                <span class="icon">⚡</span>
                <h1>OCPP Virtual Charge Point Manager</h1>
            </div>
            <div class="header-right">
                <button id="startAllBtn" class="btn btn-success">Start All</button>
                <button id="stopAllBtn" class="btn btn-danger">Stop All</button>
            </div>
        </header>

        <section class="config-section">
            <h2>Global Configuration</h2>
            <div class="config-form">
                <div class="form-group">
                    <label for="websocketUrl">WebSocket URL:</label>
                    <input type="text" id="websocketUrl" value="ws://localhost:9090/ocpp" />
                    <button id="saveConfigBtn" class="btn-icon" title="Save Configuration">💾</button>
                </div>
                <div class="form-group">
                    <label for="password">Password (optional):</label>
                    <input type="password" id="password" placeholder="Leave empty if not needed" />
                    <button class="btn-icon" title="Save Configuration">💾</button>
                </div>
            </div>
        </section>

        <section class="chargers-section">
            <div class="section-header">
                <h2>Chargers</h2>
                <button id="addChargerBtn" class="btn btn-primary">+ Add Charger</button>
            </div>
            <div id="chargersContainer" class="chargers-container">
                <!-- Chargers will be dynamically added here -->
            </div>
        </section>
    </div>

    <!-- Add Charger Modal -->
    <div id="addChargerModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Add New Charger</h3>
                <span class="close">&times;</span>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="chargerName">Name:</label>
                    <input type="text" id="chargerName" placeholder="My Charger" />
                </div>
                <div class="form-group">
                    <label for="chargerSerial">Serial:</label>
                    <input type="text" id="chargerSerial" placeholder="S001" />
                </div>
                <div class="form-group">
                    <label for="ocppVersion">OCPP Version:</label>
                    <select id="ocppVersion">
                        <option value="1.6">OCPP 1.6</option>
                        <option value="2.0.1">OCPP 2.0.1</option>
                        <option value="2.1">OCPP 2.1</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="connectorCount">Number of Connectors:</label>
                    <input type="number" id="connectorCount" value="1" min="1" max="10" />
                </div>
                <div class="form-group">
                    <label for="chargerWebsocket">WebSocket URL (optional):</label>
                    <input type="text" id="chargerWebsocket" placeholder="Uses global config if empty" />
                </div>
                <div class="form-group">
                    <label for="chargerPassword">Password (optional):</label>
                    <input type="password" id="chargerPassword" placeholder="Uses global config if empty" />
                </div>
            </div>
            <div class="modal-footer">
                <button id="cancelAddBtn" class="btn btn-secondary">Cancel</button>
                <button id="confirmAddBtn" class="btn btn-primary">Add Charger</button>
            </div>
        </div>
    </div>

    <script src="/ui/client.js"></script>
</body>
</html>`;
  }

  start(port: number = 3001) {
    console.log(
      `🚀 OCPP Virtual Charge Point UI Server starting on http://localhost:${port}`
    );
    serve({
      fetch: this.app.fetch,
      port,
    });
  }
}

// Start the server
const uiServer = new UIServer();
uiServer.start(Number(process.env.UI_PORT) || 3001);
