CREATE TABLE IF NOT EXISTS deliveries (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  event_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  endpoint_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  url VARCHAR(2048) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_response_status SMALLINT UNSIGNED NULL,
  last_error VARCHAR(2048) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  last_attempt_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uq_event_endpoint (event_id, endpoint_id),
  FOREIGN KEY (event_id) REFERENCES events(event_id),
  FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id),
  CONSTRAINT chk_attempts CHECK (attempts <= 3)
) ENGINE=InnoDB;
