-- Throwaway copy of the shared history tables (exact DDL of api/_sf-history.js and api/_tp1.js).
-- Lives only in the sfdaily-test PostgreSQL container. Never applied to any real database.
CREATE SCHEMA IF NOT EXISTS tp23;
CREATE TABLE IF NOT EXISTS tp23.sf_log_history (
    id            bigserial PRIMARY KEY,
    sent_at       timestamptz NOT NULL DEFAULT now(),
    set_code      char(1)     NOT NULL,
    equipment_no  varchar(20) NOT NULL,
    test          boolean     NOT NULL,
    use_se        varchar(10) NOT NULL,
    log_dt        varchar(23) NOT NULL,
    sys_user      varchar(60) NOT NULL,
    conect_ip     varchar(30) NOT NULL,
    data_usgqty   bigint      NOT NULL,
    http_status   integer,
    result_code   varchar(10),
    result_msg    varchar(200),
    result_detail text,
    recptn_dt     varchar(30),
    error         text
);
CREATE INDEX IF NOT EXISTS sf_log_history_sent_at_idx ON tp23.sf_log_history (sent_at DESC);

CREATE SCHEMA IF NOT EXISTS tp1;
CREATE TABLE IF NOT EXISTS tp1.sf_log_history (
    id            bigserial PRIMARY KEY,
    sent_at       timestamptz NOT NULL DEFAULT now(),
    company_code  varchar(10) NOT NULL,
    source        varchar(10) NOT NULL,
    test          boolean     NOT NULL,
    use_se        varchar(10) NOT NULL,
    log_dt        varchar(23) NOT NULL,
    sys_user      varchar(60) NOT NULL,
    conect_ip     varchar(30) NOT NULL,
    data_usgqty   bigint      NOT NULL,
    http_status   integer,
    result_code   varchar(10),
    result_msg    varchar(200),
    result_detail text,
    recptn_dt     varchar(30),
    error         text
);
CREATE INDEX IF NOT EXISTS sf_log_history_sent_at_idx ON tp1.sf_log_history (sent_at DESC);
