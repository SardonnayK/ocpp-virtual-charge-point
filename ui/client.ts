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
    document.querySelector(".close")?.addEventListener("click", () => {
      this.hideModal();
    });

    document.getElementById("cancelAddBtn")?.addEventListener("click", () => {
      this.hideModal();
    });

    document.getElementById("confirmAddBtn")?.addEventListener("click", () => {
      this.addCharger();
    });

    // Close modal when clicking outside
    window.addEventListener("click", (event) => {
      if (event.target === this.modal) {
        this.hideModal();
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
      const startBtn = document.getElementById(`start-${charger.config.id}`);
      const stopBtn = document.getElementById(`stop-${charger.config.id}`);
      const deleteBtn = document.getElementById(`delete-${charger.config.id}`);

      startBtn?.addEventListener("click", () =>
        this.startCharger(charger.config.id)
      );
      stopBtn?.addEventListener("click", () =>
        this.stopCharger(charger.config.id)
      );
      deleteBtn?.addEventListener("click", () =>
        this.deleteCharger(charger.config.id)
      );
    });
  }

  private renderChargerCard(charger: ChargerState): string {
    const statusClass = charger.status.toLowerCase();
    const isRunning = charger.status === "Running";

    return `
      <div class="charger-card">
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
