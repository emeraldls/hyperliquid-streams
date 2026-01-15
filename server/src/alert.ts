import { v4 as uuidv4 } from "uuid";
import { userStreams } from "./user-streams";

type TradeField = "last_price" | "trade_price" | "trade_volume" | "bid" | "ask";

export type ComparisonOperator =
  | "crossing"
  | "crossing-up"
  | "crossing-down"
  | "greater-than"
  | "less-than";

export type TriggerMode = "once" | "every-time";

type AlertStatus = "active" | "triggered" | "expired" | "disabled";

export type AlertSettings = {
  id: string;
  userId: string;

  symbol: string;
  field: TradeField;

  operator: ComparisonOperator;
  value: number;

  trigger: TriggerMode;

  createdAt: number;
  expiresAt?: number;

  status: AlertStatus;

  // REQUIRED for crossing logic
  lastObservedValue?: number;
};

export function evaluateAlert(
  alert: AlertSettings,
  currentValue: number
): boolean {
  const prev = alert.lastObservedValue;

  let triggered = false;

  switch (alert.operator) {
    case "greater-than":
      triggered = currentValue > alert.value;
      break;

    case "less-than":
      triggered = currentValue < alert.value;
      break;

    case "crossing":
      if (prev !== undefined) {
        triggered =
          (prev < alert.value && currentValue >= alert.value) ||
          (prev > alert.value && currentValue <= alert.value);
      }
      break;

    case "crossing-up":
      if (prev !== undefined) {
        triggered = prev < alert.value && currentValue >= alert.value;
      }
      break;

    case "crossing-down":
      if (prev !== undefined) {
        triggered = prev > alert.value && currentValue <= alert.value;
      }
      break;
  }

  alert.lastObservedValue = currentValue;

  return triggered;
}

export function dispatchAlert(alert: AlertSettings, price: number) {
  const payload = {
    alertId: alert.id,
    symbol: alert.symbol,
    price,
    operator: alert.operator,
    target: alert.value,
  };

  notifyUser(alert.userId, payload);

  console.log(
    `🚨 ALERT TRIGGERED`,
    JSON.stringify(
      {
        alertId: alert.id,
        userId: alert.userId,
        symbol: alert.symbol,
        price,
        operator: alert.operator,
        target: alert.value,
      },
      null,
      2
    )
  );
}

function notifyUser(userId: string, payload: any) {
  const streams = userStreams.get(userId);
  if (!streams) return;

  const data = `data: ${JSON.stringify(payload)}\n\n`;

  for (const res of streams) {
    res.write(data);
  }
}

export class Alert {}
