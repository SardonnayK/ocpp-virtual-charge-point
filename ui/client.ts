// Client-side TypeScript for OCPP VCP Manager UI

interface ChargerConfig {
  id: string;
  name: string;
  serial: string;
  ocppVersion: "1.6" | "2.0.1" | "2.1";
  connectors: ConnectorConfig[];
  websocketUrl: string;
  password?: string;
  adminPort: number;
}

interface ConnectorConfig {
  id: number;
  status: string;
}

interface ChargerState {
  config: ChargerConfig;
  status: "Stopped" | "Starting" | "Running" | "Stopping" | "Error";
}

interface GlobalConfig {
  websocketUrl: string;
  password?: string;
}

class VCPManagerUI {
  private chargers: ChargerState[] = [];
  private modal: HTMLElement;
  private chargersContainer: HTMLElement;

  constructor() {
    this.modal = document.getElementById("addChargerModal")!;
    this.chargersContainer = document.getElementById("chargersContainer")!;
    this.initializeEventListeners();
    this.loadConfig();
    this.loadChargers();
    this.startPolling();
  }

  private initializeEventListeners(): void {
    // Global buttons
    document.getElementById("startAllBtn")?.addEventListener("click", () => {
      this.startAllChargers();
    });

    document.getElementById("stopAllBtn")?.addEventListener("click", () => {
      this.stopAllChargers();
    });

    document.getElementById("addChargerBtn")?.addEventListener("click", () => {
      this.showModal();
    });

    document.getElementById("saveConfigBtn")?.addEventListener("click", () => {
      this.saveConfig();
    });

    // Modal buttons
    document.querySelectorAll(".close").forEach((closeBtn) => {
      closeBtn.addEventListener("click", (e) => {
        const modalId = (e.target as HTMLElement).getAttribute("data-modal");
        if (modalId) {
          const modal = document.getElementById(modalId);
          modal?.classList.remove("show");
        } else {
          this.hideModal();
        }
      });
    });

    document.getElementById("cancelAddBtn")?.addEventListener("click", () => {
      this.hideModal();
    });

    document.getElementById("confirmAddBtn")?.addEventListener("click", () => {
      this.addCharger();
    });

    // Close modals when clicking outside
    window.addEventListener("click", (event) => {
      const addModal = document.getElementById("addChargerModal");
      const detailModal = document.getElementById("chargerDetailModal");

      if (event.target === addModal) {
        this.hideModal();
      }
      if (event.target === detailModal) {
        detailModal?.classList.remove("show");
      }
    });
  }

  private async loadConfig(): Promise<void> {
    try {
      const response = await fetch("/api/config");
      const config: GlobalConfig = await response.json();

      const websocketInput = document.getElementById(
        "websocketUrl"
      ) as HTMLInputElement;
      const passwordInput = document.getElementById(
        "password"
      ) as HTMLInputElement;

      if (websocketInput) websocketInput.value = config.websocketUrl;
      if (passwordInput && config.password)
        passwordInput.value = config.password;
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  }

  private async saveConfig(): Promise<void> {
    const websocketInput = document.getElementById(
      "websocketUrl"
    ) as HTMLInputElement;
    const passwordInput = document.getElementById(
      "password"
    ) as HTMLInputElement;

    const config: GlobalConfig = {
      websocketUrl: websocketInput.value,
      password: passwordInput.value || undefined,
    };

    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      this.showNotification("Configuration saved successfully!", "success");
    } catch (error) {
      console.error("Failed to save config:", error);
      this.showNotification("Failed to save configuration", "error");
    }
  }

  private async loadChargers(): Promise<void> {
    try {
      const response = await fetch("/api/chargers");
      this.chargers = await response.json();
      this.renderChargers();
    } catch (error) {
      console.error("Failed to load chargers:", error);
    }
  }

  private renderChargers(): void {
    if (this.chargers.length === 0) {
      this.chargersContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚡</div>
          <h3>No Chargers Added</h3>
          <p>Click "Add Charger" to create your first virtual charge point</p>
        </div>
      `;
      return;
    }

    this.chargersContainer.innerHTML = this.chargers
      .map((charger) => this.renderChargerCard(charger))
      .join("");

    // Attach event listeners to dynamically created elements
    this.chargers.forEach((charger) => {
      const card = document.getElementById(`charger-card-${charger.config.id}`);
      const startBtn = document.getElementById(`start-${charger.config.id}`);
      const stopBtn = document.getElementById(`stop-${charger.config.id}`);
      const deleteBtn = document.getElementById(`delete-${charger.config.id}`);

      // Open detail modal when clicking the card (but not on buttons)
      card?.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest("button")) {
          this.showChargerDetail(charger.config.id);
        }
      });

      startBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startCharger(charger.config.id);
      });
      stopBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.stopCharger(charger.config.id);
      });
      deleteBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deleteCharger(charger.config.id);
      });
    });
  }

  private renderChargerCard(charger: ChargerState): string {
    const statusClass = charger.status.toLowerCase();
    const isRunning = charger.status === "Running";

    return `
      <div class="charger-card" id="charger-card-${charger.config.id}">
        <div class="charger-header">
          <div class="charger-title">
            <h3>${charger.config.name}</h3>
            <div class="serial">${charger.config.serial}</div>
          </div>
          <div class="charger-actions">
            <button class="icon-btn" id="delete-${
              charger.config.id
            }" title="Delete">🗑️</button>
          </div>
        </div>
        
        <div class="charger-status ${statusClass}">
          <span class="status-dot"></span>
          ${charger.status}
        </div>

        <div class="charger-info">
          <div class="info-row">
            <span class="info-label">Serial:</span>
            <span class="info-value">${charger.config.serial}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Admin Port:</span>
            <span class="info-value">${charger.config.adminPort}</span>
          </div>
          <div class="info-row">
            <span class="info-label">WebSocket:</span>
            <span class="info-value">${this.truncateUrl(
              charger.config.websocketUrl
            )}</span>
          </div>
        </div>

        <div class="connectors">
          <div class="connectors-label">Connectors:</div>
          <div class="connector-badges">
            ${charger.config.connectors
              .map(
                (conn) => `
              <span class="connector-badge">Connector ${conn.id}</span>
            `
              )
              .join("")}
          </div>
        </div>

        <div class="charger-controls">
          ${
            isRunning
              ? `<button class="btn btn-danger" id="stop-${charger.config.id}">⏹ Stop</button>`
              : `<button class="btn btn-success" id="start-${charger.config.id}">▶ Start</button>`
          }
        </div>
      </div>
    `;
  }

  private truncateUrl(url: string): string {
    if (url.length > 30) {
      return url.substring(0, 27) + "...";
    }
    return url;
  }

  private showModal(): void {
    this.modal.classList.add("show");
  }

  private hideModal(): void {
    this.modal.classList.remove("show");
    this.clearModalForm();
  }

  private clearModalForm(): void {
    (document.getElementById("chargerName") as HTMLInputElement).value = "";
    (document.getElementById("chargerSerial") as HTMLInputElement).value = "";
    (document.getElementById("ocppVersion") as HTMLSelectElement).value = "1.6";
    (document.getElementById("connectorCount") as HTMLInputElement).value = "1";
    (document.getElementById("chargerWebsocket") as HTMLInputElement).value =
      "";
    (document.getElementById("chargerPassword") as HTMLInputElement).value = "";
  }

  private async addCharger(): Promise<void> {
    const name = (document.getElementById("chargerName") as HTMLInputElement)
      .value;
    const serial = (
      document.getElementById("chargerSerial") as HTMLInputElement
    ).value;
    const ocppVersion = (
      document.getElementById("ocppVersion") as HTMLSelectElement
    ).value as "1.6" | "2.0.1" | "2.1";
    const connectorCount = parseInt(
      (document.getElementById("connectorCount") as HTMLInputElement).value
    );
    const websocketUrl = (
      document.getElementById("chargerWebsocket") as HTMLInputElement
    ).value;
    const password = (
      document.getElementById("chargerPassword") as HTMLInputElement
    ).value;

    if (!name || !serial) {
      this.showNotification("Please fill in all required fields", "error");
      return;
    }

    const connectors: ConnectorConfig[] = [];
    for (let i = 1; i <= connectorCount; i++) {
      connectors.push({
        id: i,
        status: "Available",
      });
    }

    const config: Partial<ChargerConfig> = {
      name,
      serial,
      ocppVersion,
      connectors,
      websocketUrl: websocketUrl || undefined,
      password: password || undefined,
    };

    try {
      await fetch("/api/chargers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      this.hideModal();
      this.showNotification("Charger added successfully!", "success");
      await this.loadChargers();
    } catch (error) {
      console.error("Failed to add charger:", error);
      this.showNotification("Failed to add charger", "error");
    }
  }

  private async startCharger(id: string): Promise<void> {
    try {
      const response = await fetch(`/api/chargers/${id}/start`, {
        method: "POST",
      });

      if (response.ok) {
        this.showNotification("Charger starting...", "success");
        await this.loadChargers();
      } else {
        const error = await response.json();
        this.showNotification(`Failed to start: ${error.error}`, "error");
      }
    } catch (error) {
      console.error("Failed to start charger:", error);
      this.showNotification("Failed to start charger", "error");
    }
  }

  private async stopCharger(id: string): Promise<void> {
    try {
      const response = await fetch(`/api/chargers/${id}/stop`, {
        method: "POST",
      });

      if (response.ok) {
        this.showNotification("Charger stopping...", "success");
        await this.loadChargers();
      } else {
        this.showNotification("Failed to stop charger", "error");
      }
    } catch (error) {
      console.error("Failed to stop charger:", error);
      this.showNotification("Failed to stop charger", "error");
    }
  }

  private async deleteCharger(id: string): Promise<void> {
    if (!confirm("Are you sure you want to delete this charger?")) {
      return;
    }

    try {
      await fetch(`/api/chargers/${id}`, {
        method: "DELETE",
      });

      this.showNotification("Charger deleted successfully!", "success");
      await this.loadChargers();
    } catch (error) {
      console.error("Failed to delete charger:", error);
      this.showNotification("Failed to delete charger", "error");
    }
  }

  private async startAllChargers(): Promise<void> {
    try {
      await fetch("/api/chargers/start-all", {
        method: "POST",
      });

      this.showNotification("Starting all chargers...", "success");
      await this.loadChargers();
    } catch (error) {
      console.error("Failed to start all chargers:", error);
      this.showNotification("Failed to start all chargers", "error");
    }
  }

  private async stopAllChargers(): Promise<void> {
    try {
      await fetch("/api/chargers/stop-all", {
        method: "POST",
      });

      this.showNotification("Stopping all chargers...", "success");
      await this.loadChargers();
    } catch (error) {
      console.error("Failed to stop all chargers:", error);
      this.showNotification("Failed to stop all chargers", "error");
    }
  }

  private async showChargerDetail(id: string): Promise<void> {
    const charger = this.chargers.find((c) => c.config.id === id);
    if (!charger) return;

    const modal = document.getElementById("chargerDetailModal")!;
    const nameElement = document.getElementById("detailChargerName")!;
    const connectorsList = document.getElementById("connectorsList")!;

    nameElement.textContent = `${charger.config.name} - Details`;

    // Render connectors
    connectorsList.innerHTML = charger.config.connectors
      .map((conn) => this.renderConnectorDetail(charger, conn))
      .join("");

    // Setup close buttons
    const closeButtons = modal.querySelectorAll(".close");
    closeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        modal.classList.remove("show");
      });
    });

    // Setup connector action listeners
    charger.config.connectors.forEach((conn) => {
      this.setupConnectorActions(charger, conn);
    });

    // Setup quick actions
    const heartbeatBtn = document.getElementById("sendHeartbeatBtn");
    const authorizeBtn = document.getElementById("authorizeBtn");

    heartbeatBtn?.addEventListener("click", () => this.sendHeartbeat(id));
    authorizeBtn?.addEventListener("click", () => this.showAuthorizeForm(id));

    modal.classList.add("show");

    // Close on outside click
    window.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.classList.remove("show");
      }
    });
  }

  private renderConnectorDetail(
    charger: ChargerState,
    connector: ConnectorConfig
  ): string {
    const statusClass = connector.status.toLowerCase().replace(/\s/g, "");
    const isCharging =
      connector.status === "Charging" || connector.status === "SuspendedEV";

    return `
      <div class="connector-detail-card ${statusClass}">
        <div class="connector-header">
          <h4>
            <span>🔌 Connector ${connector.id}</span>
            ${
              charger.status === "Running"
                ? '<span class="live-indicator"><span class="live-dot"></span>LIVE</span>'
                : ""
            }
          </h4>
          <span class="connector-status-badge ${statusClass}">${
      connector.status
    }</span>
        </div>

        <div class="connector-info-grid">
          <div class="info-box">
            <div class="info-box-label">Energy</div>
            <div class="info-box-value">${isCharging ? "167 Wh" : "0 Wh"}</div>
          </div>
          <div class="info-box">
            <div class="info-box-label">Power</div>
            <div class="info-box-value">${isCharging ? "11007 W" : "0 W"}</div>
          </div>
          <div class="info-box">
            <div class="info-box-label">Current</div>
            <div class="info-box-value">${isCharging ? "16.0 A" : "0 A"}</div>
          </div>
          <div class="info-box">
            <div class="info-box-label">Voltage</div>
            <div class="info-box-value">${isCharging ? "228.0 V" : "0 V"}</div>
          </div>
        </div>

        ${
          charger.status === "Running"
            ? this.renderConnectorActions(connector, isCharging)
            : '<div style="text-align: center; color: #718096; padding: 10px;">Charger must be running to perform actions</div>'
        }
      </div>
    `;
  }

  private renderConnectorActions(
    connector: ConnectorConfig,
    isCharging: boolean
  ): string {
    return `
      <div class="connector-actions">
        <select id="status-select-${connector.id}" class="status-selector">
          <option value="">Change Status...</option>
          <option value="Available">Available</option>
          <option value="Preparing">Preparing</option>
          <option value="Charging">Charging</option>
          <option value="SuspendedEVSE">SuspendedEVSE</option>
          <option value="SuspendedEV">SuspendedEV</option>
          <option value="Finishing">Finishing</option>
          <option value="Reserved">Reserved</option>
          <option value="Unavailable">Unavailable</option>
          <option value="Faulted">Faulted</option>
        </select>
        <button class="btn btn-primary" id="change-status-${
          connector.id
        }">Update</button>
      </div>
      
      <div class="connector-actions" style="margin-top: 10px;">
        ${
          !isCharging
            ? `<button class="btn btn-success" id="start-txn-${connector.id}">⚡ Start Transaction</button>`
            : `<button class="btn btn-danger" id="stop-txn-${connector.id}">⏹ Stop Transaction</button>`
        }
        <button class="btn btn-primary" id="send-meter-${
          connector.id
        }">📊 Send Meter Values</button>
      </div>

      <div id="txn-form-${connector.id}" class="transaction-form">
        <div class="form-group">
          <label>ID Tag:</label>
          <input type="text" id="idTag-${connector.id}" value="TAG${
      connector.id
    }" />
        </div>
        <div class="form-group">
          <label>Meter Start (Wh):</label>
          <input type="number" id="meterStart-${connector.id}" value="0" />
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" id="cancel-txn-${
            connector.id
          }">Cancel</button>
          <button class="btn btn-success" id="confirm-txn-${
            connector.id
          }">Confirm Start</button>
        </div>
      </div>

      <div id="stop-txn-form-${connector.id}" class="transaction-form">
        <div class="form-group">
          <label>Transaction ID:</label>
          <input type="number" id="txnId-${connector.id}" value="1" />
        </div>
        <div class="form-group">
          <label>Meter Stop (Wh):</label>
          <input type="number" id="meterStop-${connector.id}" value="1000" />
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" id="cancel-stop-${
            connector.id
          }">Cancel</button>
          <button class="btn btn-danger" id="confirm-stop-${
            connector.id
          }">Confirm Stop</button>
        </div>
      </div>
    `;
  }

  private setupConnectorActions(
    charger: ChargerState,
    connector: ConnectorConfig
  ): void {
    const statusSelect = document.getElementById(
      `status-select-${connector.id}`
    ) as HTMLSelectElement;
    const changeStatusBtn = document.getElementById(
      `change-status-${connector.id}`
    );
    const startTxnBtn = document.getElementById(`start-txn-${connector.id}`);
    const stopTxnBtn = document.getElementById(`stop-txn-${connector.id}`);
    const sendMeterBtn = document.getElementById(`send-meter-${connector.id}`);

    // Change status
    changeStatusBtn?.addEventListener("click", async () => {
      const newStatus = statusSelect.value;
      if (!newStatus) return;

      await this.changeConnectorStatus(
        charger.config.id,
        connector.id,
        newStatus
      );
      statusSelect.value = "";
    });

    // Start transaction
    startTxnBtn?.addEventListener("click", () => {
      const form = document.getElementById(`txn-form-${connector.id}`);
      form?.classList.add("show");
    });

    const cancelTxnBtn = document.getElementById(`cancel-txn-${connector.id}`);
    cancelTxnBtn?.addEventListener("click", () => {
      const form = document.getElementById(`txn-form-${connector.id}`);
      form?.classList.remove("show");
    });

    const confirmTxnBtn = document.getElementById(
      `confirm-txn-${connector.id}`
    );
    confirmTxnBtn?.addEventListener("click", async () => {
      const idTag = (
        document.getElementById(`idTag-${connector.id}`) as HTMLInputElement
      ).value;
      const meterStart = parseInt(
        (
          document.getElementById(
            `meterStart-${connector.id}`
          ) as HTMLInputElement
        ).value
      );

      await this.startTransaction(
        charger.config.id,
        connector.id,
        idTag,
        meterStart
      );

      const form = document.getElementById(`txn-form-${connector.id}`);
      form?.classList.remove("show");
    });

    // Stop transaction
    stopTxnBtn?.addEventListener("click", () => {
      const form = document.getElementById(`stop-txn-form-${connector.id}`);
      form?.classList.add("show");
    });

    const cancelStopBtn = document.getElementById(
      `cancel-stop-${connector.id}`
    );
    cancelStopBtn?.addEventListener("click", () => {
      const form = document.getElementById(`stop-txn-form-${connector.id}`);
      form?.classList.remove("show");
    });

    const confirmStopBtn = document.getElementById(
      `confirm-stop-${connector.id}`
    );
    confirmStopBtn?.addEventListener("click", async () => {
      const txnId = parseInt(
        (document.getElementById(`txnId-${connector.id}`) as HTMLInputElement)
          .value
      );
      const meterStop = parseInt(
        (
          document.getElementById(
            `meterStop-${connector.id}`
          ) as HTMLInputElement
        ).value
      );

      await this.stopTransaction(
        charger.config.id,
        connector.id,
        txnId,
        meterStop
      );

      const form = document.getElementById(`stop-txn-form-${connector.id}`);
      form?.classList.remove("show");
    });

    // Send meter values
    sendMeterBtn?.addEventListener("click", () => {
      this.sendMeterValues(charger.config.id, connector.id);
    });
  }

  private async changeConnectorStatus(
    chargerId: string,
    connectorId: number,
    status: string
  ): Promise<void> {
    try {
      const response = await fetch(
        `/api/chargers/${chargerId}/connectors/${connectorId}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );

      if (response.ok) {
        this.showNotification(
          `Connector ${connectorId} status changed to ${status}`,
          "success"
        );
        await this.loadChargers();
        // Re-render the detail view
        await this.showChargerDetail(chargerId);
      } else {
        const error = await response.json();
        this.showNotification(`Failed: ${error.error}`, "error");
      }
    } catch (error) {
      console.error("Failed to change status:", error);
      this.showNotification("Failed to change status", "error");
    }
  }

  private async startTransaction(
    chargerId: string,
    connectorId: number,
    idTag: string,
    meterStart: number
  ): Promise<void> {
    try {
      const response = await fetch(
        `/api/chargers/${chargerId}/connectors/${connectorId}/start-transaction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idTag, meterStart }),
        }
      );

      if (response.ok) {
        this.showNotification(
          `Transaction started on connector ${connectorId}`,
          "success"
        );
        await this.loadChargers();
        await this.showChargerDetail(chargerId);
      } else {
        const error = await response.json();
        this.showNotification(`Failed: ${error.error}`, "error");
      }
    } catch (error) {
      console.error("Failed to start transaction:", error);
      this.showNotification("Failed to start transaction", "error");
    }
  }

  private async stopTransaction(
    chargerId: string,
    connectorId: number,
    transactionId: number,
    meterStop: number
  ): Promise<void> {
    try {
      const response = await fetch(
        `/api/chargers/${chargerId}/connectors/${connectorId}/stop-transaction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId, meterStop }),
        }
      );

      if (response.ok) {
        this.showNotification(
          `Transaction stopped on connector ${connectorId}`,
          "success"
        );
        await this.loadChargers();
        await this.showChargerDetail(chargerId);
      } else {
        const error = await response.json();
        this.showNotification(`Failed: ${error.error}`, "error");
      }
    } catch (error) {
      console.error("Failed to stop transaction:", error);
      this.showNotification("Failed to stop transaction", "error");
    }
  }

  private async sendMeterValues(
    chargerId: string,
    connectorId: number
  ): Promise<void> {
    try {
      const response = await fetch(
        `/api/chargers/${chargerId}/connectors/${connectorId}/meter-values`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId: 1 }),
        }
      );

      if (response.ok) {
        this.showNotification("Meter values sent", "success");
      } else {
        const error = await response.json();
        this.showNotification(`Failed: ${error.error}`, "error");
      }
    } catch (error) {
      console.error("Failed to send meter values:", error);
      this.showNotification("Failed to send meter values", "error");
    }
  }

  private async sendHeartbeat(chargerId: string): Promise<void> {
    try {
      const response = await fetch(`/api/chargers/${chargerId}/heartbeat`, {
        method: "POST",
      });

      if (response.ok) {
        this.showNotification("Heartbeat sent", "success");
      } else {
        this.showNotification("Failed to send heartbeat", "error");
      }
    } catch (error) {
      console.error("Failed to send heartbeat:", error);
      this.showNotification("Failed to send heartbeat", "error");
    }
  }

  private showAuthorizeForm(chargerId: string): void {
    const idTag = prompt("Enter ID Tag to authorize:");
    if (!idTag) return;

    this.authorize(chargerId, idTag);
  }

  private async authorize(chargerId: string, idTag: string): Promise<void> {
    try {
      const response = await fetch(`/api/chargers/${chargerId}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idTag }),
      });

      if (response.ok) {
        this.showNotification(
          `Authorization request sent for ${idTag}`,
          "success"
        );
      } else {
        this.showNotification("Failed to send authorization", "error");
      }
    } catch (error) {
      console.error("Failed to authorize:", error);
      this.showNotification("Failed to authorize", "error");
    }
  }

  private startPolling(): void {
    // Poll for updates every 2 seconds
    setInterval(() => {
      this.loadChargers();
    }, 2000);
  }

  private showNotification(message: string, type: "success" | "error"): void {
    // Create a simple notification
    const notification = document.createElement("div");
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 8px;
      color: white;
      font-weight: 600;
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
      background: ${type === "success" ? "#48bb78" : "#f56565"};
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    // Add animation
    const style = document.createElement("style");
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = "slideIn 0.3s ease-out reverse";
      setTimeout(() => {
        document.body.removeChild(notification);
        document.head.removeChild(style);
      }, 300);
    }, 3000);
  }
}

// Initialize the UI when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new VCPManagerUI();
});
