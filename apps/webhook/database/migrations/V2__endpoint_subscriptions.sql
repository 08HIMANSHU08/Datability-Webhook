CREATE TABLE IF NOT EXISTS endpoint_subscriptions (
  endpoint_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  PRIMARY KEY (endpoint_id, event_type),
  INDEX idx_subscription_lookup (event_type, endpoint_id),
  FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id)
) ENGINE=InnoDB;
