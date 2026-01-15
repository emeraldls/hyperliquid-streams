import React, { useState, useEffect, useRef, useCallback } from "react";

type ComparisonOperator =
  | "crossing"
  | "crossing-up"
  | "crossing-down"
  | "greater-than"
  | "less-than";

type TriggerMode = "once" | "every-time";

type AlertStatus = "active" | "triggered" | "expired" | "disabled";

type AlertData = {
  id: string;
  userId: string;
  symbol: string;
  field: string;
  operator: ComparisonOperator;
  value: number;
  trigger: TriggerMode;
  createdAt: number;
  expiresAt?: number;
  status: AlertStatus;
};

type Notification = {
  id: string;
  alertId: string;
  symbol: string;
  price: number;
  operator: ComparisonOperator;
  target: number;
  timestamp: number;
};

const API_URL = "http://localhost:3002";

const OPERATORS: { value: ComparisonOperator; label: string }[] = [
  { value: "crossing", label: "Crossing" },
  { value: "crossing-up", label: "Crossing Up" },
  { value: "crossing-down", label: "Crossing Down" },
  { value: "greater-than", label: "Greater Than" },
  { value: "less-than", label: "Less Than" },
];

const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "BNBUSD", "XRPUSD"];

const Alert = () => {
  const [userId] = useState(
    () => `user_${Math.random().toString(36).slice(2, 9)}`
  );
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Form state
  const [symbol, setSymbol] = useState<string>("BTCUSD");
  const [operator, setOperator] = useState<ComparisonOperator>("crossing");
  const [value, setValue] = useState<string>("");
  const [trigger, setTrigger] = useState<TriggerMode>("once");

  // Fetch alerts
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/alert?userId=${userId}`);
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (err) {
      console.error("Failed to fetch alerts:", err);
    }
  }, [userId]);

  // Create alert
  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || isNaN(Number(value))) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          symbol,
          operator,
          value: Number(value),
          trigger,
        }),
      });

      if (res.ok) {
        setValue("");
        fetchAlerts();
      }
    } catch (err) {
      console.error("Failed to create alert:", err);
    } finally {
      setLoading(false);
    }
  };

  // SSE connection for notifications
  useEffect(() => {
    fetchAlerts();

    const eventSource = new EventSource(`${API_URL}/events?userId=${userId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const notification: Notification = {
          ...data,
          id: `notif_${Date.now()}`,
          timestamp: Date.now(),
        };
        setNotifications((prev) => [notification, ...prev].slice(0, 50));
        fetchAlerts();
      } catch (err) {
        console.error("Failed to parse SSE message:", err);
      }
    };

    eventSource.onerror = () => {
      console.error("SSE connection error");
    };

    return () => {
      eventSource.close();
    };
  }, [userId, fetchAlerts]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getOperatorLabel = (op: ComparisonOperator) => {
    return OPERATORS.find((o) => o.value === op)?.label || op;
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Price Alerts</h1>
        <span style={styles.userId}>ID: {userId}</span>
      </div>

      <div style={styles.mainContent}>
        {/* Left Panel - Create Alert */}
        <div style={styles.leftPanel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.panelTitle}>Create Alert</h2>
          </div>

          <form onSubmit={handleCreateAlert} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Symbol</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                style={styles.select}
              >
                {SYMBOLS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Condition</label>
              <div style={styles.conditionBox}>
                <span style={styles.conditionLabel}>Price</span>
              </div>
              <select
                value={operator}
                onChange={(e) =>
                  setOperator(e.target.value as ComparisonOperator)
                }
                style={styles.select}
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Value</label>
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Enter price value"
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Trigger</label>
              <div style={styles.triggerGroup}>
                <button
                  type="button"
                  onClick={() => setTrigger("once")}
                  style={{
                    ...styles.triggerButton,
                    ...(trigger === "once" ? styles.triggerButtonActive : {}),
                  }}
                >
                  Only once
                </button>
                <button
                  type="button"
                  onClick={() => setTrigger("every-time")}
                  style={{
                    ...styles.triggerButton,
                    ...(trigger === "every-time"
                      ? styles.triggerButtonActive
                      : {}),
                  }}
                >
                  Every time
                </button>
              </div>
              <span style={styles.triggerHint}>
                {trigger === "once"
                  ? "The alert will only trigger once and will not be repeated"
                  : "The alert will trigger every time the condition is met"}
              </span>
            </div>

            <div style={styles.formActions}>
              <button
                type="button"
                onClick={() => setValue("")}
                style={styles.cancelButton}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !value}
                style={{
                  ...styles.createButton,
                  opacity: loading || !value ? 0.5 : 1,
                }}
              >
                {loading ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>

        {/* Right Panel - Alerts List */}
        <div style={styles.rightPanel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.panelTitle}>My Alerts</h2>
            <span style={styles.alertCount}>{alerts.length}</span>
          </div>

          <div style={styles.alertsList}>
            {alerts.length === 0 ? (
              <div style={styles.emptyState}>No alerts created yet</div>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} style={styles.alertItem}>
                  <div style={styles.alertHeader}>
                    <span style={styles.alertSymbol}>{alert.symbol}</span>
                    <span
                      style={{
                        ...styles.alertStatus,
                        color:
                          alert.status === "active"
                            ? "#10b981"
                            : alert.status === "triggered"
                            ? "#f59e0b"
                            : "#6b7280",
                      }}
                    >
                      {alert.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={styles.alertCondition}>
                    Price {getOperatorLabel(alert.operator)}{" "}
                    {alert.value.toLocaleString()}
                  </div>
                  <div style={styles.alertMeta}>
                    <span>
                      {alert.trigger === "once" ? "Once" : "Every time"}
                    </span>
                    <span>{formatDate(alert.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Bottom Panel - Notifications */}
      <div style={styles.bottomPanel}>
        <div style={styles.panelHeader}>
          <h2 style={styles.panelTitle}>Notifications</h2>
          {notifications.length > 0 && (
            <button
              onClick={() => setNotifications([])}
              style={styles.clearButton}
            >
              Clear
            </button>
          )}
        </div>

        <div style={styles.notificationsList}>
          {notifications.length === 0 ? (
            <div style={styles.emptyState}>No notifications yet</div>
          ) : (
            notifications.map((notif) => (
              <div key={notif.id} style={styles.notificationItem}>
                <span style={styles.notificationTime}>
                  {formatTime(notif.timestamp)}
                </span>
                <span style={styles.notificationSymbol}>{notif.symbol}</span>
                <span style={styles.notificationText}>
                  Price {getOperatorLabel(notif.operator)}{" "}
                  {notif.target.toLocaleString()} triggered at{" "}
                  {notif.price.toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#000000",
    color: "#ffffff",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    padding: "24px",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "24px",
    paddingBottom: "16px",
    borderBottom: "1px solid #222222",
  },
  title: {
    fontSize: "20px",
    fontWeight: 600,
    margin: 0,
  },
  userId: {
    fontSize: "12px",
    color: "#666666",
    fontFamily: "monospace",
  },
  mainContent: {
    display: "grid",
    gridTemplateColumns: "400px 1fr",
    gap: "24px",
    marginBottom: "24px",
  },
  leftPanel: {
    backgroundColor: "#0a0a0a",
    border: "1px solid #222222",
    padding: "20px",
  },
  rightPanel: {
    backgroundColor: "#0a0a0a",
    border: "1px solid #222222",
    padding: "20px",
    maxHeight: "500px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
    paddingBottom: "12px",
    borderBottom: "1px solid #222222",
  },
  panelTitle: {
    fontSize: "14px",
    fontWeight: 500,
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: "#888888",
  },
  alertCount: {
    fontSize: "12px",
    color: "#666666",
    backgroundColor: "#1a1a1a",
    padding: "2px 8px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  label: {
    fontSize: "12px",
    fontWeight: 500,
    color: "#888888",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  select: {
    backgroundColor: "#0a0a0a",
    border: "1px solid #333333",
    color: "#ffffff",
    padding: "12px",
    fontSize: "14px",
    outline: "none",
    cursor: "pointer",
  },
  conditionBox: {
    backgroundColor: "#1a1a1a",
    border: "1px solid #333333",
    padding: "12px",
    marginBottom: "8px",
  },
  conditionLabel: {
    fontSize: "14px",
    color: "#ffffff",
  },
  input: {
    backgroundColor: "#0a0a0a",
    border: "1px solid #333333",
    color: "#ffffff",
    padding: "12px",
    fontSize: "14px",
    outline: "none",
  },
  triggerGroup: {
    display: "flex",
    gap: "0",
  },
  triggerButton: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    border: "1px solid #333333",
    color: "#888888",
    padding: "12px",
    fontSize: "13px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  triggerButtonActive: {
    backgroundColor: "#ffffff",
    color: "#000000",
    borderColor: "#ffffff",
  },
  triggerHint: {
    fontSize: "12px",
    color: "#666666",
    lineHeight: 1.4,
  },
  formActions: {
    display: "flex",
    gap: "12px",
    marginTop: "12px",
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "transparent",
    border: "1px solid #333333",
    color: "#888888",
    padding: "12px",
    fontSize: "14px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  createButton: {
    flex: 1,
    backgroundColor: "#ffffff",
    border: "1px solid #ffffff",
    color: "#000000",
    padding: "12px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  alertsList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  emptyState: {
    color: "#666666",
    fontSize: "13px",
    textAlign: "center",
    padding: "40px 20px",
  },
  alertItem: {
    backgroundColor: "#111111",
    border: "1px solid #222222",
    padding: "16px",
  },
  alertHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  alertSymbol: {
    fontSize: "14px",
    fontWeight: 600,
  },
  alertStatus: {
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.5px",
  },
  alertCondition: {
    fontSize: "13px",
    color: "#cccccc",
    marginBottom: "8px",
  },
  alertMeta: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "11px",
    color: "#666666",
  },
  bottomPanel: {
    backgroundColor: "#0a0a0a",
    border: "1px solid #222222",
    padding: "20px",
    maxHeight: "200px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  clearButton: {
    backgroundColor: "transparent",
    border: "1px solid #333333",
    color: "#666666",
    padding: "4px 12px",
    fontSize: "11px",
    cursor: "pointer",
  },
  notificationsList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  notificationItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 12px",
    backgroundColor: "#111111",
    border: "1px solid #222222",
    fontSize: "13px",
  },
  notificationTime: {
    color: "#666666",
    fontFamily: "monospace",
    fontSize: "11px",
    minWidth: "80px",
  },
  notificationSymbol: {
    fontWeight: 600,
    minWidth: "70px",
  },
  notificationText: {
    color: "#cccccc",
  },
};

export default Alert;
