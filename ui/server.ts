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
import { startTransactionOcppMessage } from "../src/v16/messages/startTransaction";
import { stopTransactionOcppMessage } from "../src/v16/messages/stopTransaction";
import { authorizeOcppMessage } from "../src/v16/messages/authorize";
import { meterValuesOcppMessage } from "../src/v16/messages/meterValues";
import { heartbeatOcppMessage } from "../src/v16/messages/heartbeat";
import { logger } from "../src/logger";

interface ChargerInstance {
  vcp: VCP;
  config: ChargerConfig;
  status: "Stopped" | "Starting" | "Running" | "Stopping" | "Error";
}

interface PersistedState {
  version: number;
  globalConfig: GlobalConfig;
  chargers: ChargerConfig[];
}

class UIServer {
  private static readonly STATE_FILE_PATH = path.join(
    __dirname,
    "chargers-state.json"
  );
  private static readonly STATE_VERSION = 1;
  private static readonly DEBOUNCE_DELAY = 2000; // 2 seconds

  private chargers: Map<string, ChargerInstance> = new Map();
  private globalConfig: GlobalConfig = {
    websocketUrl: "ws://localhost:9090/ocpp",
    password: undefined,
  };
  private app: Hono;
  private saveStateTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.app = new Hono();
    this.loadState();
    this.setupRoutes();
  }

  private loadState(): void {
    try {
      if (fs.existsSync(UIServer.STATE_FILE_PATH)) {
        const fileContent = fs.readFileSync(UIServer.STATE_FILE_PATH, "utf-8");
        const state: PersistedState = JSON.parse(fileContent);

        // Check version compatibility
        if (state.version !== UIServer.STATE_VERSION) {
          logger.warn(
            `State file version mismatch. Expected ${UIServer.STATE_VERSION}, got ${state.version}. Ignoring saved state.`
          );
          return;
        }

        // Restore global config
        if (state.globalConfig) {
          this.globalConfig = state.globalConfig;
        }

        // Restore chargers in Stopped state
        if (state.chargers && Array.isArray(state.chargers)) {
          for (const config of state.chargers) {
            this.chargers.set(config.id, {
              config,
              vcp: null as any,
              status: "Stopped",
            });
          }
          logger.info(
            `Restored ${state.chargers.length} charger(s) from state file`
          );
        }
      }
    } catch (error) {
      logger.error("Failed to load state from file:", error);
      // Continue with empty state on error
    }
  }

  private saveState(immediate = false): void {
    const performSave = () => {
      try {
        const chargerConfigs: ChargerConfig[] = Array.from(
          this.chargers.values()
        ).map((instance) => instance.config);

        const state: PersistedState = {
          version: UIServer.STATE_VERSION,
          globalConfig: this.globalConfig,
          chargers: chargerConfigs,
        };

        fs.writeFileSync(
          UIServer.STATE_FILE_PATH,
          JSON.stringify(state, null, 2),
          "utf-8"
        );
        logger.debug("State saved successfully");
      } catch (error) {
        logger.error("Failed to save state to file:", error);
      }
    };

    if (immediate) {
      // Clear any pending debounced save and save immediately
      if (this.saveStateTimeout) {
        clearTimeout(this.saveStateTimeout);
        this.saveStateTimeout = null;
      }
      performSave();
    } else {
      // Debounced save
      if (this.saveStateTimeout) {
        clearTimeout(this.saveStateTimeout);
      }
      this.saveStateTimeout = setTimeout(() => {
        performSave();
        this.saveStateTimeout = null;
      }, UIServer.DEBOUNCE_DELAY);
    }
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
      this.saveState(true); // Immediate save for critical config change
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

      this.saveState(true); // Immediate save for critical operation
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
          basicAuthPassword: instance.config.password || undefined,
          adminPort: instance.config.adminPort,
          skipProcessExit: true, // Don't exit process when charger stops
        });

        try {
          await vcp.connect();
        } catch (connectError: any) {
          instance.status = "Error";
          logger.error(`WebSocket connection failed for ${id}:`, connectError);

          let errorMessage = "Connection failed";
          if (connectError.message?.includes("401")) {
            errorMessage =
              "Authentication failed (401). Check your password or leave it empty if not required.";
          } else if (connectError.message?.includes("ECONNREFUSED")) {
            errorMessage =
              "Connection refused. Make sure the OCPP server is running.";
          } else if (connectError.message) {
            errorMessage = connectError.message;
          }

          return c.json({ error: errorMessage }, 500);
        }

        instance.vcp = vcp;
        instance.status = "Running";

        // Set up event handlers for connection lifecycle
        vcp.on("disconnected", ({ code, reason, graceful }) => {
          logger.warn(
            `Charger ${id} disconnected. Code: ${code}, Reason: ${reason}, Graceful: ${graceful}`
          );
          if (!graceful) {
            instance.status = "Error";
            logger.error(
              `Charger ${id} disconnected unexpectedly. You may need to restart it.`
            );
          } else {
            instance.status = "Stopped";
          }
        });

        vcp.on("error", (error) => {
          logger.error(`Charger ${id} error:`, error);
          instance.status = "Error";
        });

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
          try {
            instance.vcp.close();
          } catch (closeError) {
            logger.error(`Error closing VCP for ${id}:`, closeError);
          }
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
      this.saveState(true); // Immediate save for critical operation
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
              basicAuthPassword: instance.config.password || undefined,
              adminPort: instance.config.adminPort,
              skipProcessExit: true, // Don't exit process when charger stops
            });

            await vcp.connect();
            instance.vcp = vcp;
            instance.status = "Running";

            // Set up event handlers for connection lifecycle
            vcp.on("disconnected", ({ code, reason, graceful }) => {
              logger.warn(
                `Charger ${id} disconnected. Code: ${code}, Reason: ${reason}, Graceful: ${graceful}`
              );
              if (!graceful) {
                instance.status = "Error";
                logger.error(
                  `Charger ${id} disconnected unexpectedly. You may need to restart it.`
                );
              } else {
                instance.status = "Stopped";
              }
            });

            vcp.on("error", (error) => {
              logger.error(`Charger ${id} error:`, error);
              instance.status = "Error";
            });

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
          } catch (error: any) {
            instance.status = "Error";
            let errorMessage = String(error);
            if (error.message?.includes("401")) {
              errorMessage = "Authentication failed (401)";
            } else if (error.message?.includes("ECONNREFUSED")) {
              errorMessage = "Connection refused";
            } else if (error.message) {
              errorMessage = error.message;
            }
            results.push({ id, success: false, error: errorMessage });
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
              try {
                instance.vcp.close();
              } catch (closeError) {
                logger.error(`Error closing VCP for ${id}:`, closeError);
              }
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

    // Get specific charger details
    this.app.get("/api/chargers/:id", (c) => {
      const id = c.req.param("id");
      const instance = this.chargers.get(id);

      if (!instance) {
        return c.json({ error: "Charger not found" }, 404);
      }

      return c.json({
        config: instance.config,
        status: instance.status,
      });
    });

    // Update connector status
    this.app.post(
      "/api/chargers/:id/connectors/:connectorId/status",
      async (c) => {
        const id = c.req.param("id");
        const connectorId = parseInt(c.req.param("connectorId"));
        const instance = this.chargers.get(id);

        if (!instance) {
          return c.json({ error: "Charger not found" }, 404);
        }

        if (instance.status !== "Running") {
          return c.json({ error: "Charger must be running" }, 400);
        }

        const body = await c.req.json();
        const { status, errorCode = "NoError" } = body;

        try {
          // Update the connector status in config
          const connector = instance.config.connectors.find(
            (c) => c.id === connectorId
          );
          if (connector) {
            connector.status = status;
          }

          // Send status notification
          instance.vcp.send(
            statusNotificationOcppMessage.request({
              connectorId,
              errorCode,
              status,
            })
          );

          this.saveState(); // Debounced save for connector updates
          return c.json({ success: true });
        } catch (error) {
          logger.error(`Failed to update connector status:`, error);
          return c.json({ error: String(error) }, 500);
        }
      }
    );

    // Start transaction
    this.app.post(
      "/api/chargers/:id/connectors/:connectorId/start-transaction",
      async (c) => {
        const id = c.req.param("id");
        const connectorId = parseInt(c.req.param("connectorId"));
        const instance = this.chargers.get(id);

        if (!instance) {
          return c.json({ error: "Charger not found" }, 404);
        }

        if (instance.status !== "Running") {
          return c.json({ error: "Charger must be running" }, 400);
        }

        const body = await c.req.json();
        const { idTag, meterStart = 0, reservationId } = body;

        try {
          const connector = instance.config.connectors.find(
            (c) => c.id === connectorId
          );
          if (connector) {
            connector.idTag = idTag;
          }

          instance.vcp.send(
            startTransactionOcppMessage.request({
              connectorId,
              idTag,
              meterStart,
              timestamp: new Date().toISOString(),
              reservationId,
            })
          );

          this.saveState(); // Debounced save
          return c.json({ success: true });
        } catch (error) {
          logger.error(`Failed to start transaction:`, error);
          return c.json({ error: String(error) }, 500);
        }
      }
    );

    // Stop transaction
    this.app.post(
      "/api/chargers/:id/connectors/:connectorId/stop-transaction",
      async (c) => {
        const id = c.req.param("id");
        const connectorId = parseInt(c.req.param("connectorId"));
        const instance = this.chargers.get(id);

        if (!instance) {
          return c.json({ error: "Charger not found" }, 404);
        }

        if (instance.status !== "Running") {
          return c.json({ error: "Charger must be running" }, 400);
        }

        const body = await c.req.json();
        const { transactionId, meterStop, idTag, reason = "Local" } = body;

        try {
          const connector = instance.config.connectors.find(
            (c) => c.id === connectorId
          );
          if (connector) {
            connector.transactionId = undefined;
            connector.idTag = undefined;
          }

          instance.vcp.send(
            stopTransactionOcppMessage.request({
              transactionId,
              meterStop: meterStop || 1000,
              timestamp: new Date().toISOString(),
              idTag,
              reason,
            })
          );

          this.saveState(); // Debounced save
          return c.json({ success: true });
        } catch (error) {
          logger.error(`Failed to stop transaction:`, error);
          return c.json({ error: String(error) }, 500);
        }
      }
    );

    // Authorize
    this.app.post("/api/chargers/:id/authorize", async (c) => {
      const id = c.req.param("id");
      const instance = this.chargers.get(id);

      if (!instance) {
        return c.json({ error: "Charger not found" }, 404);
      }

      if (instance.status !== "Running") {
        return c.json({ error: "Charger must be running" }, 400);
      }

      const body = await c.req.json();
      const { idTag } = body;

      try {
        instance.vcp.send(
          authorizeOcppMessage.request({
            idTag,
          })
        );

        return c.json({ success: true });
      } catch (error) {
        logger.error(`Failed to authorize:`, error);
        return c.json({ error: String(error) }, 500);
      }
    });

    // Send meter values
    this.app.post(
      "/api/chargers/:id/connectors/:connectorId/meter-values",
      async (c) => {
        const id = c.req.param("id");
        const connectorId = parseInt(c.req.param("connectorId"));
        const instance = this.chargers.get(id);

        if (!instance) {
          return c.json({ error: "Charger not found" }, 404);
        }

        if (instance.status !== "Running") {
          return c.json({ error: "Charger must be running" }, 400);
        }

        const body = await c.req.json();
        const { transactionId, meterValue } = body;

        try {
          instance.vcp.send(
            meterValuesOcppMessage.request({
              connectorId,
              transactionId,
              meterValue: meterValue || [
                {
                  timestamp: new Date().toISOString(),
                  sampledValue: [
                    {
                      value: "100",
                      context: "Sample.Periodic",
                      measurand: "Energy.Active.Import.Register",
                      unit: "Wh",
                    },
                  ],
                },
              ],
            })
          );

          return c.json({ success: true });
        } catch (error) {
          logger.error(`Failed to send meter values:`, error);
          return c.json({ error: String(error) }, 500);
        }
      }
    );

    // Send heartbeat
    this.app.post("/api/chargers/:id/heartbeat", async (c) => {
      const id = c.req.param("id");
      const instance = this.chargers.get(id);

      if (!instance) {
        return c.json({ error: "Charger not found" }, 404);
      }

      if (instance.status !== "Running") {
        return c.json({ error: "Charger must be running" }, 400);
      }

      try {
        instance.vcp.send(heartbeatOcppMessage.request({}));
        return c.json({ success: true });
      } catch (error) {
        logger.error(`Failed to send heartbeat:`, error);
        return c.json({ error: String(error) }, 500);
      }
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
                    <input type="password" id="password" placeholder="Leave empty if no auth required" />
                    <button class="btn-icon" title="Save Configuration">💾</button>
                </div>
            </div>
            <div style="padding: 10px 30px; font-size: 13px; color: #718096;">
                💡 <strong>Tip:</strong> If you get a 401 error, your OCPP server requires authentication. Leave password empty if no authentication is needed.
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
                <span class="close" data-modal="addChargerModal">&times;</span>
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

    <!-- Charger Detail Modal -->
    <div id="chargerDetailModal" class="modal">
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h3 id="detailChargerName">Charger Details</h3>
                <span class="close" data-modal="chargerDetailModal">&times;</span>
            </div>
            <div class="modal-body">
                <div id="connectorsList" class="connectors-detail">
                    <!-- Connectors will be populated dynamically -->
                </div>
                <div class="actions-section">
                    <h4>Quick Actions</h4>
                    <div class="action-buttons">
                        <button id="sendHeartbeatBtn" class="btn btn-primary">💓 Send Heartbeat</button>
                        <button id="authorizeBtn" class="btn btn-primary">🔐 Authorize</button>
                    </div>
                </div>
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

// Add process-level error handlers to prevent server crashes
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
  // Don't exit - just log the error and continue
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection at:", promise, "reason:", reason);
  // Don't exit - just log the error and continue
});

// Start the server
const uiServer = new UIServer();
uiServer.start(Number(process.env.UI_PORT) || 3001);
