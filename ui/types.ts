export interface ChargerConfig {
  id: string;
  name: string;
  serial: string;
  ocppVersion: "1.6" | "2.0.1" | "2.1";
  connectors: ConnectorConfig[];
  websocketUrl: string;
  password?: string;
  adminPort: number;
}

export interface ConnectorConfig {
  id: number;
  status: ConnectorStatus;
  transactionId?: number | string;
  idTag?: string;
}

export type ConnectorStatus =
  | "Available"
  | "Preparing"
  | "Charging"
  | "SuspendedEVSE"
  | "SuspendedEV"
  | "Finishing"
  | "Reserved"
  | "Unavailable"
  | "Faulted";

export type ChargerStatus =
  | "Stopped"
  | "Starting"
  | "Running"
  | "Stopping"
  | "Error";

export interface ChargerState {
  config: ChargerConfig;
  status: ChargerStatus;
  lastMessage?: string;
  lastMessageTime?: Date;
}

export interface GlobalConfig {
  websocketUrl: string;
  password?: string;
}
